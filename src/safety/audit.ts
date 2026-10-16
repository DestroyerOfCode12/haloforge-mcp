/**
 * HaloForge MCP | Audit log
 *
 * Every write (create, update, delete and raw API writes) is appended as one
 * JSON line to logs/audit.jsonl (override with HALO_AUDIT_LOG, disable with
 * HALO_AUDIT_LOG=off). Entries hold the changed field paths, not values, and
 * pass through secret masking.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { redact } from "../utils/secrets.js";
import { logger } from "../utils/logger.js";

export interface AuditEntry {
  time?: string;
  instance: string;
  tool: string;
  resource: string;
  action: "create" | "update" | "delete" | "request";
  ids: Array<number | string>;
  method?: string;
  path?: string;
  status: "ok" | "error";
  error?: string;
  diff?: { count: number; paths: string[]; more?: number };
  records?: number;
}

export class AuditLog {
  readonly path: string | null;

  constructor(path: string | undefined = process.env.HALO_AUDIT_LOG) {
    if (path && path.toLowerCase() === "off") this.path = null;
    else this.path = resolve(path || "logs/audit.jsonl");
  }

  write(entry: AuditEntry): void {
    if (!this.path) return;
    const line = JSON.stringify(redact({ time: new Date().toISOString(), ...entry }));
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, line + "\n", { encoding: "utf8" });
    } catch (err) {
      logger.error("Could not write the audit log", { path: this.path, error: (err as Error).message });
    }
  }
}
