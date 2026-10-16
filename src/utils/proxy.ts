/**
 * HaloForge MCP | Outbound proxy support
 *
 * Node's built in fetch ignores HTTPS_PROXY and HTTP_PROXY unless
 * NODE_USE_ENV_PROXY=1 is set (and only on recent Node versions). To make
 * proxies work everywhere, install undici's EnvHttpProxyAgent as the global
 * dispatcher whenever a proxy variable is present. It honours NO_PROXY too.
 */

import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

let configured = false;

export function proxyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || undefined;
}

/**
 * Configure the global fetch dispatcher for proxies. Returns true when a
 * proxy was configured. Safe to call more than once.
 */
export function configureProxy(env: NodeJS.ProcessEnv = process.env): boolean {
  if (configured) return true;
  if (env.HALO_DISABLE_PROXY === "true") return false;
  if (!proxyFromEnv(env)) return false;
  // EnvHttpProxyAgent emits an "experimental" warning on creation; it is stable
  // in practice and the warning only confuses MCP client logs.
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const code = typeof rest[0] === "object" && rest[0] ? (rest[0] as { code?: string }).code : rest[1];
    if (code === "UNDICI-EHPA") return;
    (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  } finally {
    process.emitWarning = emit;
  }
  configured = true;
  return true;
}
