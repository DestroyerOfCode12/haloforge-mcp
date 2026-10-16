/**
 * Test helpers: a routed fetch mock and a tool harness.
 * All URLs use placeholder hosts; nothing leaves the process.
 */

import { vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadInstances } from "../src/types/config.js";
import { InstanceManager } from "../src/client/instance-manager.js";
import { AuditLog } from "../src/safety/audit.js";
import { buildAllTools, RegisteredTool } from "../src/tools/registry.js";

export interface Call {
  method: string;
  url: URL;
  body?: unknown;
}

export type Route = (call: Call) => unknown | Response | undefined;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

/** Install a fetch mock. Token requests are answered automatically. */
export function mockFetch(route: Route) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.pathname.endsWith("/auth/token")) {
      return json({ access_token: `token-for-${url.host}-0123456789`, token_type: "Bearer", expires_in: 32400 });
    }
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { method, url, body };
    calls.push(call);
    const out = route(call);
    if (out instanceof Response) return out;
    if (out === undefined) return json({ message: "not mocked" }, 404);
    return json(out);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls, apiCalls: () => calls };
}

export const TRIAL_URL = "https://trial.example.invalid";
export const PROD_URL = "https://prod.example.invalid";

export function twoInstanceEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    HALO_INSTANCES: "trial,prod",
    HALO_TRIAL_BASE_URL: TRIAL_URL,
    HALO_TRIAL_CLIENT_ID: "trial-id",
    HALO_TRIAL_CLIENT_SECRET: "trial-secret-value-xyz",
    HALO_TRIAL_MODE: "write",
    HALO_PROD_BASE_URL: PROD_URL,
    HALO_PROD_CLIENT_ID: "prod-id",
    HALO_PROD_CLIENT_SECRET: "prod-secret-value-xyz",
    HALO_PROD_MODE: "read",
    ...extra,
  };
}

export function singleEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    HALO_BASE_URL: TRIAL_URL,
    HALO_CLIENT_ID: "single-id",
    HALO_CLIENT_SECRET: "single-secret-value-xyz",
    ...extra,
  };
}

export function auditPath(): string {
  return join(mkdtempSync(join(tmpdir(), "haloforge-test-")), "audit.jsonl");
}

export function harness(env: NodeJS.ProcessEnv, audit = auditPath()) {
  const { instances, defaultName } = loadInstances(env);
  const manager = new InstanceManager(instances, defaultName, { maxRetries: 2, baseBackoffMs: 1 });
  const tools = buildAllTools(manager, new AuditLog(audit));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const tool: RegisteredTool | undefined = tools.get(name);
    if (!tool) throw new Error(`Tool ${name} is not registered`);
    const result = await tool.handler(args);
    const text = result.content[0].text;
    return { result, text, data: JSON.parse(text), isError: result.isError === true };
  };
  return { manager, tools, call, audit };
}
