import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { harness, mockFetch, singleEnv, TRIAL_URL } from "../helpers.js";

const current = {
  id: 7,
  name: "MCP TEST | Incident",
  fields: [
    { fieldid: 10, groupid: 1, seq: 1 },
    { fieldid: 11, groupid: 1, seq: 2 },
  ],
};

function haloStub() {
  return mockFetch(({ method, url, body }) => {
    if (method === "GET" && url.pathname === "/api/TicketType/7") return current;
    if (method === "POST" && url.pathname === "/api/TicketType") {
      const list = body as Array<Record<string, unknown>>;
      return list.length === 1 ? { ...list[0], id: list[0].id ?? 900 } : list.map((r, i) => ({ ...r, id: r.id ?? 900 + i }));
    }
    return undefined;
  });
}

describe("upsert with dry run, merge and batch", () => {
  it("dry run reads the record, returns the diff and saves nothing", async () => {
    const http = haloStub();
    const { call, audit } = harness(singleEnv({ HALO_MODE: "write" }));
    const res = await call("halo_tickettypes_upsert", { data: { id: 7, fields: [{ fieldid: 11, seq: 4 }] }, dry_run: true, show_payload: true });
    expect(res.data.dry_run).toBe(true);
    expect(res.data.saved).toBe(false);
    expect(res.data.items[0].changes).toEqual([{ path: "fields[fieldid=11].seq", before: 2, after: 4 }]);
    expect(res.data.items[0].payload.fields).toHaveLength(2);
    expect(http.calls.map((c) => c.method)).toEqual(["GET"]);
    expect(http.calls[0].url.searchParams.get("includedetails")).toBe("true");
    expect(() => readFileSync(audit)).toThrow();
  });

  it("an update sends the merged nested array and writes an audit entry without values", async () => {
    const http = haloStub();
    const { call, audit } = harness(singleEnv({ HALO_MODE: "write" }));
    const res = await call("halo_tickettypes_upsert", { data: { id: 7, fields: [{ fieldid: 11, seq: 4 }] } });
    expect(res.data.saved).toBe(true);
    const post = http.calls.find((c) => c.method === "POST")!;
    expect(post.url.toString()).toBe(`${TRIAL_URL}/api/TicketType`);
    expect(post.body).toEqual([{ id: 7, fields: [{ fieldid: 10, groupid: 1, seq: 1 }, { fieldid: 11, groupid: 1, seq: 4 }] }]);
    const entry = JSON.parse(readFileSync(audit, "utf8").trim());
    expect(entry).toMatchObject({ instance: "default", tool: "halo_tickettypes_upsert", resource: "TicketType", action: "update", ids: [7], status: "ok" });
    expect(entry.diff).toEqual({ count: 1, paths: ["fields[fieldid=11].seq"] });
    expect(JSON.stringify(entry)).not.toContain("MCP TEST");
  });

  it("skips the write when nothing changes", async () => {
    const http = haloStub();
    const { call } = harness(singleEnv({ HALO_MODE: "write" }));
    const res = await call("halo_tickettypes_upsert", { data: { id: 7, name: "MCP TEST | Incident" } });
    expect(res.data.saved).toBe(false);
    expect(res.data.message).toMatch(/No changes/);
    expect(http.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a batch is sent in one API call and new ids are reported", async () => {
    const http = haloStub();
    const { call, audit } = harness(singleEnv({ HALO_MODE: "write" }));
    const res = await call("halo_tickettypes_upsert", {
      data: [{ name: "MCP TEST | A" }, { name: "MCP TEST | B" }, { id: 7, name: "MCP TEST | Incident (renamed)" }],
    });
    const posts = http.calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toHaveLength(3);
    expect(res.data.items.map((i: { action: string; id: number }) => [i.action, i.id])).toEqual([["create", 900], ["create", 901], ["update", 7]]);
    expect(readFileSync(audit, "utf8").trim().split("\n")).toHaveLength(3);
  });

  it("merge: false sends data exactly as given", async () => {
    const http = haloStub();
    const { call } = harness(singleEnv({ HALO_MODE: "write" }));
    await call("halo_tickettypes_upsert", { data: { id: 7, fields: [{ fieldid: 11, seq: 4 }] }, merge: false });
    expect(http.calls.find((c) => c.method === "POST")!.body).toEqual([{ id: 7, fields: [{ fieldid: 11, seq: 4 }] }]);
  });
});
