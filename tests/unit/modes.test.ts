import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { harness, mockFetch, singleEnv, twoInstanceEnv } from "../helpers.js";

const names = (tools: Map<string, unknown>) => [...tools.keys()];

describe("safety modes", () => {
  it("read mode (the default) registers no create, update or delete tools", () => {
    const { tools } = harness(singleEnv());
    expect(names(tools).some((n) => n.endsWith("_upsert"))).toBe(false);
    expect(names(tools).some((n) => n.endsWith("_delete"))).toBe(false);
    expect(tools.has("halo_tickettypes_list")).toBe(true);
    expect(tools.has("halo_api_request")).toBe(true);
  });

  it("write mode registers upsert but not delete", () => {
    const { tools } = harness(singleEnv({ HALO_MODE: "write" }));
    expect(tools.has("halo_tickettypes_upsert")).toBe(true);
    expect(names(tools).some((n) => n.endsWith("_delete"))).toBe(false);
  });

  it("full mode still has no delete unless HALO_DISABLE_DELETE=false", () => {
    expect(harness(singleEnv({ HALO_MODE: "full" })).tools.has("halo_tickettypes_delete")).toBe(false);
    expect(harness(singleEnv({ HALO_MODE: "full", HALO_DISABLE_DELETE: "true" })).tools.has("halo_tickettypes_delete")).toBe(false);
    expect(harness(singleEnv({ HALO_MODE: "full", HALO_DISABLE_DELETE: "false" })).tools.has("halo_tickettypes_delete")).toBe(true);
    expect(harness(singleEnv({ HALO_MODE: "write", HALO_DISABLE_DELETE: "false" })).tools.has("halo_tickettypes_delete")).toBe(false);
  });

  it("refuses a write against a read mode instance but allows a dry run there", async () => {
    const http = mockFetch(({ method }) => (method === "GET" ? { id: 5, name: "MCP TEST | Type", sequence: 1 } : { id: 5 }));
    const { call } = harness(twoInstanceEnv());

    const refused = await call("halo_tickettypes_upsert", { instance: "prod", data: { id: 5, sequence: 2 } });
    expect(refused.isError).toBe(true);
    expect(refused.data.error).toMatch(/read mode/);
    expect(http.calls).toHaveLength(0);

    const preview = await call("halo_tickettypes_upsert", { instance: "prod", data: { id: 5, sequence: 2 }, dry_run: true });
    expect(preview.isError).toBe(false);
    expect(preview.data.dry_run).toBe(true);
    expect(http.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("dry_run never unlocks a delete or a raw write", async () => {
    const http = mockFetch(() => ({}));
    const env = twoInstanceEnv({ HALO_TRIAL_MODE: "full", HALO_TRIAL_DISABLE_DELETE: "false" });
    const { call } = harness(env);
    const del = await call("halo_tickettypes_delete", { instance: "prod", id: 3, dry_run: true });
    expect(del.data.error).toMatch(/Delete is disabled/);
    const post = await call("halo_api_request", { instance: "prod", method: "POST", path: "/TicketType", body: [{ id: 1 }], dry_run: true });
    expect(post.data.error).toMatch(/read mode/);
    expect(http.calls).toHaveLength(0);
  });

  it("enforces the write allowlist", async () => {
    const http = mockFetch(() => ({ id: 1 }));
    const { call } = harness(singleEnv({ HALO_MODE: "write", HALO_WRITE_ALLOWLIST: "Report" }));
    const refused = await call("halo_tickettypes_upsert", { data: { name: "MCP TEST | New" } });
    expect(refused.isError).toBe(true);
    expect(refused.data.error).toMatch(/allowlist/);
    expect(http.calls).toHaveLength(0);
    const allowed = await call("halo_reports_upsert", { data: { name: "MCP TEST | Report" } });
    expect(allowed.isError).toBe(false);
  });

  it("delete is refused per instance and audited when it runs", async () => {
    const http = mockFetch(() => ({}));
    const env = twoInstanceEnv({ HALO_TRIAL_MODE: "full", HALO_TRIAL_DISABLE_DELETE: "false" });
    const { call, audit } = harness(env);
    const refused = await call("halo_tickettypes_delete", { instance: "prod", id: 3 });
    expect(refused.data.error).toMatch(/Delete is disabled/);
    expect(http.calls).toHaveLength(0);
    await call("halo_tickettypes_delete", { instance: "trial", id: 3 });
    expect(http.calls[0].method).toBe("DELETE");
    expect(existsSync(audit)).toBe(true);
    expect(JSON.parse(readFileSync(audit, "utf8").trim())).toMatchObject({ instance: "trial", action: "delete", ids: [3] });
  });

  it("halo_api_request allows GET in read mode and refuses POST and DELETE", async () => {
    const http = mockFetch(({ url }) => (url.pathname === "/api/Lookup" ? [{ id: 1, name: "Group" }] : undefined));
    const { call } = harness(singleEnv());
    const ok = await call("halo_api_request", { method: "GET", path: "/api/Lookup", query: { lookupid: 41 } });
    expect(ok.data).toEqual([{ id: 1, name: "Group" }]);
    expect(http.calls[0].url.searchParams.get("lookupid")).toBe("41");
    expect((await call("halo_api_request", { method: "POST", path: "/Lookup", body: [] })).data.error).toMatch(/read mode/);
    expect((await call("halo_api_request", { method: "DELETE", path: "/Lookup/1" })).data.error).toMatch(/Delete is disabled/);
    expect((await call("halo_api_request", { path: "https://elsewhere.invalid/api/x" })).data.error).toMatch(/relative/);
    expect((await call("halo_api_request", { path: "/Lookup/../auth" })).data.error).toMatch(/\.\./);
    expect(http.calls).toHaveLength(1);
  });

  it("lists instances without credentials", async () => {
    mockFetch(() => undefined);
    const { call } = harness(twoInstanceEnv());
    const res = await call("halo_instances_list");
    expect(res.text).not.toMatch(/secret/i);
    expect(res.data.instances.map((i: { name: string; can_write: boolean }) => [i.name, i.can_write])).toEqual([["trial", true], ["prod", false]]);
  });
});
