/**
 * HaloForge MCP | Secret masking
 *
 * Every client secret and access token the server handles is registered here,
 * and every log line, error message and audit entry passes through
 * maskSecrets() before it leaves the process.
 */

const MASK = "***";
const secrets = new Set<string>();

const SENSITIVE_KEY = /(secret|password|passwd|token|authori[sz]ation|api_?key|bearer|credential|private_?key)/i;

/** Register a value that must never appear in output. Short values are ignored. */
export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 6) secrets.add(value);
}

export function clearSecrets(): void {
  secrets.clear();
}

/** Replace every registered secret and any bearer token in the text. */
export function maskSecrets(text: string): string {
  let out = text;
  for (const s of secrets) {
    if (out.includes(s)) out = out.split(s).join(MASK);
  }
  return out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${MASK}`);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Deep copy with sensitive keys replaced and registered secrets masked. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 20) return value;
  if (typeof value === "string") return maskSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) && v !== null && v !== undefined && v !== "" ? MASK : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
