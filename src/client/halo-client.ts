/**
 * HaloForge MCP | HTTP Client
 *
 * Wraps all Halo API communication for one instance with:
 * - Automatic Bearer token injection
 * - Rate limiting (700 requests per 5 minutes, per instance)
 * - Retry with exponential backoff and jitter
 * - Circuit breaker
 * - Timeout handling
 *
 * Retries are deliberately conservative for writes: a POST or DELETE is only
 * retried when Halo says it did not process the request (429), never after a
 * server error or a dropped connection, so a create can never be sent twice.
 */

import { HaloConfig } from "../types/config.js";
import { HaloAuth } from "../auth/oauth2.js";
import { RateLimiter } from "./rate-limiter.js";
import { logger } from "../utils/logger.js";
import { maskSecrets } from "../utils/secrets.js";
import { describeNetworkError } from "../utils/network.js";

export { describeNetworkError };

const DEFAULT_TIMEOUT_MS = 30_000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 30_000;
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

export type HttpMethod = "GET" | "POST" | "DELETE";

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  params?: Record<string, unknown>;
  body?: unknown;
  timeout?: number;
  /** Send the body exactly as given (default wraps objects in an array for upserts) */
  rawBody?: boolean;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export interface ClientOptions {
  maxRetries?: number;
  baseBackoffMs?: number;
  rateLimiter?: RateLimiter;
}

export class HaloApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(maskSecrets(message));
    this.name = "HaloApiError";
  }
}

export class HaloClient {
  private auth: HaloAuth;
  private rateLimiter: RateLimiter;
  private config: HaloConfig;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;

  constructor(config: HaloConfig, options: ClientOptions = {}) {
    this.config = config;
    this.auth = new HaloAuth(config);
    this.rateLimiter = options.rateLimiter ?? new RateLimiter();
    this.maxRetries = options.maxRetries ?? parseInt(process.env.HALO_MAX_RETRIES || "3", 10);
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
  }

  get instanceName(): string {
    return this.config.name;
  }

  /**
   * Set a pre-existing Bearer token (from OAuth proxy flow).
   */
  setToken(token: string): void {
    this.auth.setStaticToken(token);
  }

  /**
   * Set real Halo credentials so the client can auto-refresh tokens
   * via Client Credentials grant when the initial token expires.
   */
  setCredentials(clientId: string, clientSecret: string): void {
    this.auth.setCredentials(clientId, clientSecret);
  }

  async list<T = unknown>(path: string, params?: Record<string, unknown>): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "GET", path, params });
  }

  async get<T = unknown>(path: string, id: number | string, params?: Record<string, unknown>): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "GET", path: `${path}/${encodeURIComponent(String(id))}`, params });
  }

  /** POST to create or update. Objects are wrapped in an array, as Halo expects. */
  async post<T = unknown>(path: string, body: unknown, params?: Record<string, unknown>): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "POST", path, body, params });
  }

  async delete<T = unknown>(path: string, id: number | string, params?: Record<string, unknown>): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "DELETE", path: `${path}/${encodeURIComponent(String(id))}`, params });
  }

  getRateLimitStatus() {
    return this.rateLimiter.getStatus();
  }

  isAuthenticated(): boolean {
    return this.auth.isAuthenticated();
  }

  buildUrl(path: string, params?: Record<string, unknown>): URL {
    const url = new URL(`${this.config.baseUrl}/api${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue;
        if (Array.isArray(value)) {
          // Halo expects CSV for primitive array filters (team, agent, status, ...)
          // and JSON for object array params (advanced_search).
          const isObjectArray = value.length > 0 && typeof value[0] === "object" && value[0] !== null;
          url.searchParams.set(key, isObjectArray ? JSON.stringify(value) : value.join(","));
        } else if (typeof value === "object") {
          url.searchParams.set(key, JSON.stringify(value));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url;
  }

  /**
   * Core request method with retry, rate limiting, and circuit breaker.
   */
  async request<T>(options: RequestOptions, attempt = 0, authRetried = false): Promise<ApiResponse<T>> {
    if (Date.now() < this.circuitOpenUntil) {
      throw new HaloApiError(
        `Circuit breaker open for instance "${this.config.name}" after repeated failures. Retry after ${new Date(this.circuitOpenUntil).toISOString()}`
      );
    }

    await this.rateLimiter.acquire();

    const url = this.buildUrl(options.path, options.params);
    const token = await this.auth.getToken();
    const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
    const idempotent = options.method === "GET";

    const fetchOptions: RequestInit = {
      method: options.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };
    if (options.body !== undefined && options.method === "POST") {
      const body = options.rawBody || Array.isArray(options.body) ? options.body : [options.body];
      fetchOptions.body = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    fetchOptions.signal = controller.signal;
    const startTime = Date.now();

    let response: Response;
    try {
      logger.debug(`${options.method} ${url.pathname}`, {
        instance: this.config.name,
        params: options.params ? Object.keys(options.params).join(",") : undefined,
      });
      response = await fetch(url.toString(), fetchOptions);
    } catch (error) {
      clearTimeout(timeoutId);
      const isTimeout = error instanceof Error && error.name === "AbortError";
      if (idempotent && attempt < this.maxRetries) {
        const waitMs = this.backoffMs(attempt);
        logger.warn(`${isTimeout ? "Timeout" : "Network error"} on GET ${url.pathname}. Retry ${attempt + 1}/${this.maxRetries} after ${Math.round(waitMs)}ms`);
        await this.delay(waitMs);
        return this.request<T>(options, attempt + 1, authRetried);
      }
      this.recordFailure();
      if (isTimeout) {
        throw new HaloApiError(`Request timed out after ${timeout}ms: ${options.method} ${options.path} on instance "${this.config.name}"`);
      }
      throw new HaloApiError(
        `Could not reach instance "${this.config.name}" (${describeNetworkError(error)}). Check network access and proxy settings.` +
          (idempotent ? "" : " The write was not retried; check whether it was applied before trying again.")
      );
    }
    clearTimeout(timeoutId);

    const duration = Date.now() - startTime;
    logger.info(`${options.method} ${url.pathname} -> ${response.status} (${duration}ms)`, { instance: this.config.name });

    if (response.ok) {
      this.consecutiveFailures = 0;
      let data: T;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        data = (await response.json()) as T;
      } else {
        const text = await response.text();
        try {
          data = (text ? JSON.parse(text) : text) as T;
        } catch {
          data = text as unknown as T;
        }
      }
      return { ok: true, status: response.status, data };
    }

    if (response.status === 401 && !authRetried) {
      logger.warn("Received 401. Refreshing token and retrying.", { instance: this.config.name });
      await this.auth.forceRefresh();
      return this.request<T>(options, attempt, true);
    }
    if (response.status === 401) {
      this.recordFailure();
      throw new HaloApiError(
        `Halo rejected the token for instance "${this.config.name}" (HTTP 401) even after a refresh. ` +
          "Check the API application's permissions and that it is still active.",
        401
      );
    }

    if (response.status === 429 && attempt < this.maxRetries) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "", 10);
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : this.backoffMs(attempt);
      logger.warn(`Rate limited (429). Retry ${attempt + 1}/${this.maxRetries} after ${Math.round(waitMs)}ms`);
      await this.delay(waitMs);
      return this.request<T>(options, attempt + 1, authRetried);
    }

    if (RETRYABLE_STATUS.has(response.status) && idempotent && attempt < this.maxRetries) {
      const waitMs = this.backoffMs(attempt);
      logger.warn(`Server error (${response.status}). Retry ${attempt + 1}/${this.maxRetries} after ${Math.round(waitMs)}ms`);
      await this.delay(waitMs);
      return this.request<T>(options, attempt + 1, authRetried);
    }

    if (response.status === 429 || RETRYABLE_STATUS.has(response.status)) this.recordFailure();

    const errorText = await response.text().catch(() => "");
    if (errorText) {
      logger.error("Halo API error details", {
        instance: this.config.name,
        status: response.status,
        path: options.path,
        responseBody: errorText.substring(0, 1000),
      });
    }
    let errorMessage = `Halo API error (${response.status}) on ${options.method} ${options.path} for instance "${this.config.name}"`;
    if (response.status === 403) errorMessage += ". The API application lacks permission for this resource";
    if (response.status === 404) errorMessage += ". Not found";
    if (errorText) {
      try {
        const errorJson = JSON.parse(errorText);
        const msg = errorJson.message ?? errorJson.error ?? errorJson.title;
        if (msg) errorMessage += ` | ${String(msg).substring(0, 300)}`;
      } catch {
        if (errorText.length < 300 && !/<html/i.test(errorText)) errorMessage += ` | ${errorText}`;
      }
    }
    throw new HaloApiError(errorMessage, response.status);
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
      logger.error(
        `Circuit breaker OPEN for instance "${this.config.name}" after ${this.consecutiveFailures} consecutive failures. Reset at ${new Date(this.circuitOpenUntil).toISOString()}`
      );
    }
  }

  private backoffMs(attempt: number): number {
    const base = this.baseBackoffMs * Math.pow(2, attempt);
    return base + Math.random() * this.baseBackoffMs;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
