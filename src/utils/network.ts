/**
 * HaloForge MCP | Network error descriptions
 */

/** Short description of a fetch failure, including proxy refusals. */
export function describeNetworkError(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string } };
  const cause = e?.cause;
  if (cause?.message && /proxy response \((\d+)\)/i.test(cause.message)) {
    const status = cause.message.match(/proxy response \((\d+)\)/i)![1];
    return `the proxy refused the connection with HTTP ${status}; the host may not be allowed by the network policy`;
  }
  return cause?.code || cause?.message || e?.message || "network error";
}
