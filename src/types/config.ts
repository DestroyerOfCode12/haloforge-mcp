/**
 * HaloForge MCP | Configuration
 *
 * Instances are configured in one of three ways (checked in this order):
 *
 * 1. HALO_INSTANCES=trial,prod with HALO_<NAME>_BASE_URL, HALO_<NAME>_CLIENT_ID,
 *    HALO_<NAME>_CLIENT_SECRET and optionally HALO_<NAME>_MODE,
 *    HALO_<NAME>_DISABLE_DELETE, HALO_<NAME>_WRITE_ALLOWLIST, HALO_<NAME>_SCOPE,
 *    HALO_<NAME>_TENANT.
 * 2. The original single instance variables HALO_BASE_URL, HALO_CLIENT_ID and
 *    HALO_CLIENT_SECRET (instance name "default").
 * 3. Any HALO_<NAME>_BASE_URL variables found in the environment.
 *
 * Safety settings default to the safest values: HALO_MODE=read and
 * HALO_DISABLE_DELETE=true. Per instance values override the global ones.
 */

import { registerSecret } from "../utils/secrets.js";

export type HaloMode = "read" | "write" | "full";

export interface HaloConfig {
  /** Instance name, lower case (for example "trial") */
  name: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  tenant?: string;
  logLevel: "debug" | "info" | "warn" | "error";
  /** read: no create or update; write: create and update; full: also delete (if enabled) */
  mode: HaloMode;
  /** Delete is only possible when this is false and mode is full */
  disableDelete: boolean;
  /** When set, only these resources may be written (lower case API names or tool names) */
  writeAllowlist?: Set<string>;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface CachedToken {
  accessToken: string;
  expiresAt: number; // Unix timestamp in ms
}

/**
 * Validate that a URL is well formed and uses an allowed protocol.
 */
function validateUrl(raw: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use http or https (got ${parsed.protocol})`);
  }
  return parsed;
}

function parseMode(raw: string | undefined, label: string): HaloMode {
  const value = (raw || "read").trim().toLowerCase();
  if (value === "read" || value === "write" || value === "full") return value;
  throw new Error(`${label} must be read, write or full (got "${raw}")`);
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return fallback;
}

function parseList(raw: string | undefined): Set<string> | undefined {
  if (!raw || raw.trim() === "") return undefined;
  return new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

function logLevelFrom(env: NodeJS.ProcessEnv): HaloConfig["logLevel"] {
  const v = env.LOG_LEVEL as HaloConfig["logLevel"] | undefined;
  return v && ["debug", "info", "warn", "error"].includes(v) ? v : "info";
}

/**
 * Build one instance config from a variable prefix ("HALO_" or "HALO_TRIAL_").
 * Safety settings fall back to the global HALO_MODE, HALO_DISABLE_DELETE and
 * HALO_WRITE_ALLOWLIST.
 */
function buildInstance(name: string, prefix: string, env: NodeJS.ProcessEnv, requireCredentials = true): HaloConfig {
  const baseUrl = env[`${prefix}BASE_URL`];
  const clientId = env[`${prefix}CLIENT_ID`];
  const clientSecret = env[`${prefix}CLIENT_SECRET`];

  if (!baseUrl) throw new Error(`${prefix}BASE_URL environment variable is required`);
  if (requireCredentials && !clientId) throw new Error(`${prefix}CLIENT_ID environment variable is required`);
  if (requireCredentials && !clientSecret) throw new Error(`${prefix}CLIENT_SECRET environment variable is required`);
  validateUrl(baseUrl, `${prefix}BASE_URL`);
  registerSecret(clientSecret);

  const pick = (key: string) => (prefix === "HALO_" ? env[`HALO_${key}`] : env[`${prefix}${key}`] ?? env[`HALO_${key}`]);

  return {
    name,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    clientId: clientId ?? "",
    clientSecret: clientSecret ?? "",
    scope: pick("SCOPE") || "all",
    tenant: pick("TENANT") || undefined,
    logLevel: logLevelFrom(env),
    mode: parseMode(pick("MODE"), `${prefix}MODE`),
    disableDelete: parseBool(pick("DISABLE_DELETE"), true),
    writeAllowlist: parseList(pick("WRITE_ALLOWLIST")),
  };
}

const RESERVED_PREFIXES = new Set(["", "DEFAULT"]);

/**
 * Load every configured instance. The first one is the default unless
 * HALO_DEFAULT_INSTANCE names another.
 */
export function loadInstances(env: NodeJS.ProcessEnv = process.env): { instances: HaloConfig[]; defaultName: string } {
  let instances: HaloConfig[];

  if (env.HALO_INSTANCES && env.HALO_INSTANCES.trim() !== "") {
    const names = env.HALO_INSTANCES.split(",").map((s) => s.trim()).filter(Boolean);
    instances = names.map((n) => {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(n)) {
        throw new Error(`Instance name "${n}" in HALO_INSTANCES must be letters, digits or underscores`);
      }
      return buildInstance(n.toLowerCase(), `HALO_${n.toUpperCase()}_`, env);
    });
  } else if (env.HALO_BASE_URL) {
    instances = [buildInstance("default", "HALO_", env)];
  } else {
    const found = Object.keys(env)
      .map((k) => k.match(/^HALO_([A-Z][A-Z0-9_]*)_BASE_URL$/)?.[1])
      .filter((n): n is string => Boolean(n) && !RESERVED_PREFIXES.has(n as string))
      .sort();
    if (found.length === 0) {
      throw new Error(
        "No Halo instance configured. Set HALO_BASE_URL, HALO_CLIENT_ID and HALO_CLIENT_SECRET, " +
          "or HALO_INSTANCES=name1,name2 with HALO_<NAME>_BASE_URL, HALO_<NAME>_CLIENT_ID and HALO_<NAME>_CLIENT_SECRET."
      );
    }
    instances = found.map((n) => buildInstance(n.toLowerCase(), `HALO_${n}_`, env));
  }

  if (instances.length === 0) throw new Error("HALO_INSTANCES is empty");
  const seen = new Set<string>();
  for (const i of instances) {
    if (seen.has(i.name)) throw new Error(`Instance "${i.name}" is configured twice`);
    seen.add(i.name);
  }

  const requestedDefault = env.HALO_DEFAULT_INSTANCE?.trim().toLowerCase();
  if (requestedDefault && !seen.has(requestedDefault)) {
    throw new Error(`HALO_DEFAULT_INSTANCE "${requestedDefault}" is not a configured instance`);
  }
  return { instances, defaultName: requestedDefault || instances[0].name };
}

/**
 * Single instance config for OAuth proxy mode, where credentials arrive at
 * connection time. Safety settings still come from the environment.
 */
export function loadOAuthInstance(baseUrl: string, env: NodeJS.ProcessEnv = process.env): HaloConfig {
  const config = buildInstance("default", "HALO_", { ...env, HALO_BASE_URL: baseUrl }, false);
  return { ...config, clientId: "oauth-proxy", clientSecret: "unused" };
}

/** Backwards compatible helper: the default instance only. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): HaloConfig {
  const { instances, defaultName } = loadInstances(env);
  return instances.find((i) => i.name === defaultName)!;
}

export { validateUrl };
