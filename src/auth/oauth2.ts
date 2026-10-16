/**
 * HaloForge MCP | OAuth2 Client Credentials Authentication
 *
 * Handles token acquisition, caching, and automatic refresh.
 * Tokens are cached in memory and refreshed 60 seconds before expiry.
 */

import { z } from "zod";
import { HaloConfig, CachedToken } from "../types/config.js";
import { logger } from "../utils/logger.js";
import { registerSecret } from "../utils/secrets.js";
import { describeNetworkError } from "../utils/network.js";

// Validate the shape of Halo's token response to catch malformed data early
const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive(),
});

const TOKEN_REFRESH_BUFFER_MS = 60_000; // Refresh 60s before expiry

export class HaloAuth {
  private config: HaloConfig;
  private cachedToken: CachedToken | null = null;
  private refreshPromise: Promise<string> | null = null;
  private staticToken: string | null = null;

  constructor(config: HaloConfig) {
    this.config = config;
  }

  /**
   * Set a static token (from OAuth proxy flow). When set, the auth module
   * uses this token directly instead of fetching via Client Credentials.
   */
  setStaticToken(token: string): void {
    registerSecret(token);
    this.staticToken = token;
  }

  /**
   * Set real Halo credentials for auto-refresh in OAuth proxy mode.
   * When set, the auth module can fetch new tokens via Client Credentials
   * when the initial token expires, instead of returning a stale static token.
   */
  setCredentials(clientId: string, clientSecret: string): void {
    registerSecret(clientSecret);
    this.config = { ...this.config, clientId, clientSecret };
    logger.debug("Credentials set for token auto-refresh");
  }

  /**
   * Get a valid access token, refreshing if necessary.
   * If a static token is set (OAuth proxy mode) and we have credentials,
   * the static token is used initially but auto-refreshes via Client Credentials
   * when it approaches expiry.
   * Deduplicates concurrent refresh requests.
   */
  async getToken(): Promise<string> {
    // OAuth proxy mode with no credentials: return static token as-is
    if (this.staticToken && this.config.clientId === "oauth-proxy") {
      return this.staticToken;
    }

    // If we have a static token but also real credentials, treat the
    // static token as a cached token so it can be refreshed when expired
    if (this.staticToken && this.config.clientId !== "oauth-proxy") {
      // Seed the cache with the static token (assume ~1 hour validity)
      if (!this.cachedToken) {
        this.cachedToken = {
          accessToken: this.staticToken,
          expiresAt: Date.now() + 3500 * 1000, // ~58 minutes, will refresh before real expiry
        };
        logger.info("Seeded token cache from OAuth proxy token (auto-refresh enabled)");
      }
      this.staticToken = null; // Switch to managed mode
    }

    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.cachedToken.accessToken;
    }

    // Deduplicate concurrent token requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.fetchToken();
    try {
      const token = await this.refreshPromise;
      return token;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Force a token refresh (e.g., after a 401 response).
   */
  async forceRefresh(): Promise<string> {
    this.cachedToken = null;
    return this.getToken();
  }

  /**
   * Fetch a new token from the Halo auth endpoint.
   */
  private async fetchToken(): Promise<string> {
    const tokenUrl = this.config.tenant
      ? `${this.config.baseUrl}/auth/token?tenant=${encodeURIComponent(this.config.tenant)}`
      : `${this.config.baseUrl}/auth/token`;
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope,
    });

    logger.debug("Requesting new access token", { tokenUrl });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let response: globalThis.Response;
    try {
      response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Token request to instance "${this.config.name}" timed out. The Halo server may be unresponsive.`);
      }
      throw new Error(
        `Could not reach instance "${this.config.name}" for a token (${describeNetworkError(err)}). ` +
          "Check the base URL, network access and proxy settings (HTTPS_PROXY)."
      );
    }
    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let haloError = "";
      try {
        const parsed = JSON.parse(errorBody) as { error?: string; error_description?: string };
        haloError = [parsed.error, parsed.error_description].filter(Boolean).join(": ").substring(0, 200);
      } catch {
        // not JSON
      }
      logger.error("Token request failed", { instance: this.config.name, status: response.status, haloError });
      throw new Error(authErrorMessage(this.config.name, response.status, haloError));
    }

    const raw = await response.json();
    const parsed = TokenResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error("Invalid token response from Halo", { issues: parsed.error.issues });
      throw new Error("Received malformed token response from Halo");
    }
    const data = parsed.data;

    registerSecret(data.access_token);
    this.cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    logger.info("Access token acquired", {
      expiresIn: data.expires_in,
      expiresAt: new Date(this.cachedToken.expiresAt).toISOString(),
    });

    return data.access_token;
  }

  /**
   * Check if we currently have a valid token.
   */
  isAuthenticated(): boolean {
    return this.cachedToken !== null && Date.now() < this.cachedToken.expiresAt;
  }
}

/** A clear, actionable message for a failed token request. Never includes secrets. */
export function authErrorMessage(instance: string, status: number, haloError = ""): string {
  const prefix = `HALO_${instance.toUpperCase()}_`;
  const detail = haloError ? ` Halo said: ${haloError}.` : "";
  if (status === 400 || status === 401) {
    return (
      `Authentication failed for instance "${instance}" (HTTP ${status}).${detail} ` +
      `Check ${prefix}CLIENT_ID and ${prefix}CLIENT_SECRET (or HALO_CLIENT_ID and HALO_CLIENT_SECRET), ` +
      "that the API application is active, uses Client ID and Secret (Services) and has the 'all' scope. " +
      "A newly created API application can return 401 for a minute or two."
    );
  }
  if (status === 403) {
    return `Authentication refused for instance "${instance}" (HTTP 403).${detail} The API application may lack permissions.`;
  }
  if (status === 404) {
    return `Token endpoint not found for instance "${instance}" (HTTP 404). Check the base URL; it should be the root, for example https://yourcompany.haloitsm.com.`;
  }
  return `Authentication failed for instance "${instance}" (HTTP ${status}).${detail}`;
}
