import { describe, it, expect, afterEach } from "vitest";
import { harness, mockFetch, singleEnv, twoInstanceEnv, PROD_URL, TRIAL_URL } from "../helpers.js";

function paged(total: number) {
  return mockFetch(({ url }) => {
    if (url.pathname !== "/api/Report") return undefined;
    const size = Number(url.searchParams.get("page_size"));
    const page = Number(url.searchParams.get("page_no"));
    const start = (page - 1) * size;
    const records = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => ({
      id: start + i + 1,
      name: `MCP TEST | Report ${start + i + 1}`,
      sql: "select 1",
    }));
    return { record_count: total, records };
  });
}

describe("pagination and output control", () => {
  afterEach(() => {
    delete process.env.HALO_MAX_OUTPUT_CHARS;
  });

  it("returns one page with correct metadata by default", async () => {
    const http = paged(120);
    const { call } = harness(singleEnv());
    const res = await call("halo_reports_list", { page_size: 50 });
    expect(res.data.pagination).toMatchObject({ total_count: 120, returned: 50, page_no: 1, total_pages: 3, has_more: true });
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].url.searchParams.get("pageinate")).toBe("true");
  });

  it("all_pages walks every page", async () => {
    const http = paged(120);
    const { call } = harness(singleEnv());
    const res = await call("halo_reports_list", { all_pages: true, page_size: 50 });
    expect(res.data.records).toHaveLength(120);
    expect(res.data.pagination).toMatchObject({ total_count: 120, returned: 120, pages_fetched: 3, has_more: false });
    expect(http.calls.map((c) => c.url.searchParams.get("page_no"))).toEqual(["1", "2", "3"]);
    expect(http.calls.every((c) => !c.url.searchParams.has("all_pages"))).toBe(true);
  });

  it("max_items stops early and says so", async () => {
    paged(500);
    const { call } = harness(singleEnv());
    const res = await call("halo_reports_list", { all_pages: true, page_size: 50, max_items: 70 });
    expect(res.data.records).toHaveLength(70);
    expect(res.data.pagination).toMatchObject({ has_more: true, truncated_by_max_items: true, total_count: 500 });
  });

  it("handles bare array endpoints and named record keys", async () => {
    mockFetch(({ url }) => {
      if (url.pathname === "/api/Status") return [{ id: 1, name: "New" }, { id: 2, name: "Closed" }];
      if (url.pathname === "/api/Tickets") return { record_count: 1, tickets: [{ id: 3, summary: "MCP TEST | Ticket" }], columns: [] };
      return undefined;
    });
    const { call } = harness(singleEnv());
    const statuses = await call("halo_status_list", { all_pages: true });
    expect(statuses.data.records).toHaveLength(2);
    expect(statuses.data.pagination.pages_fetched).toBe(1);
    const tickets = await call("halo_tickets_list", {});
    expect(tickets.data.records).toEqual([{ id: 3, summary: "MCP TEST | Ticket" }]);
    expect(tickets.data.pagination.total_count).toBe(1);
  });

  it("fields returns only the chosen fields, including dot paths", async () => {
    mockFetch(({ url }) => (url.pathname === "/api/TicketType/1" ? { id: 1, name: "x", big: "y".repeat(100), fields: { a: 1, b: 2 } } : undefined));
    const { call } = harness(singleEnv());
    const res = await call("halo_tickettypes_get", { id: 1, fields: ["id", "fields.a", "missing"] });
    expect(res.data).toEqual({ id: 1, fields: { a: 1 } });
  });

  it("large output becomes a compact summary with a notice, never silently cut", async () => {
    process.env.HALO_MAX_OUTPUT_CHARS = "5000";
    paged(200);
    const { call } = harness(singleEnv());
    const res = await call("halo_reports_list", { all_pages: true, page_size: 100 });
    expect(res.text.length).toBeLessThan(6000);
    expect(res.data.compact_summary).toBe(true);
    expect(res.data.notice).toMatch(/over the 5000 character limit/);
    expect(res.data.available_fields).toEqual(["id", "name", "sql"]);
    expect(res.data.pagination.returned).toBe(200);
    expect(res.data.records[0]).toEqual({ id: 1, name: "MCP TEST | Report 1" });
  });

  it("routes each call to the selected instance", async () => {
    const http = mockFetch(() => []);
    const { call } = harness(twoInstanceEnv());
    await call("halo_status_list", {});
    await call("halo_status_list", { instance: "prod" });
    await call("halo_status_list", { instance: "PROD" });
    expect(http.calls.map((c) => c.url.origin)).toEqual([TRIAL_URL, PROD_URL, PROD_URL]);
    const tokenHosts = http.fn.mock.calls.map((c) => new URL(String(c[0]))).filter((u) => u.pathname === "/auth/token").map((u) => u.origin);
    expect(tokenHosts).toEqual([TRIAL_URL, PROD_URL]);
    const unknown = await call("halo_status_list", { instance: "staging" });
    expect(unknown.data.error).toMatch(/Unknown instance "staging".*trial, prod/);
  });
});
