import { describe, it, expect } from "vitest";
import { harness, mockFetch, singleEnv } from "../helpers.js";
import { checkGrid } from "../../src/tools/config/dashboards.js";

const report = {
  id: 30,
  guid: "00000000-0000-0000-0000-000000000030",
  name: "MCP TEST | Open by team",
  group_id: 5,
  sql: "select team, status from faults",
  charttype: 0,
  xaxis: "team",
};
const rows = [
  { team: "A", status: "Open" },
  { team: "B", status: "Open" },
  { team: "A", status: "Closed" },
];
const groups = [{ id: 5, name: "MCP TEST | Group" }, { id: 6, name: "MCP TEST | Second" }];

function stub(posts: unknown[] = []) {
  return mockFetch(({ method, url, body }) => {
    if (method === "POST") {
      posts.push(body);
      return Array.isArray(body) && body.length === 1 ? { ...(body[0] as object), id: 99 } : body;
    }
    if (url.pathname === "/api/Report/30") {
      return url.searchParams.get("loadreport") === "true" ? { ...report, report: { rows } } : report;
    }
    if (url.pathname === "/api/Lookup" && url.searchParams.get("lookupid") === "41") return groups;
    if (url.pathname === "/api/DashboardLinks/4") {
      return {
        id: 4,
        name: "MCP TEST | Dashboard",
        widgets: [{ id: 1, type: 1, report_id: 30, title: "Existing" }],
        layouts: JSON.stringify({ lg: [{ i: "1", x: 0, y: 0, w: 6, h: 4 }], md: [{ i: "1", x: 0, y: 0, w: 5, h: 4 }] }),
        access_control: [],
      };
    }
    return undefined;
  });
}

describe("reports", () => {
  it("runs a report and counts rows per value", async () => {
    const http = stub();
    const { call } = harness(singleEnv());
    const res = await call("halo_reports_run", { id: 30, count_by: "team", sample_rows: 1 });
    expect(http.calls[0].url.searchParams.get("loadreport")).toBe("true");
    expect(res.data).toMatchObject({ row_count: 3, columns: ["team", "status"], sample_rows: [rows[0]] });
    expect(res.data.count_by).toEqual({ column: "team", distinct: 2, counts: [{ value: "A", count: 2 }, { value: "B", count: 1 }] });
    expect((await call("halo_reports_run", { id: 30, count_by: "nope" })).data.error).toMatch(/Columns: team, status/);
  });

  it("clones with overrides and a group by name, without identity fields", async () => {
    const posts: unknown[] = [];
    stub(posts);
    const { call } = harness(singleEnv({ HALO_MODE: "write" }));
    const res = await call("halo_reports_clone", { id: 30, name: "MCP TEST | Copy", group: "MCP TEST | Second", overrides: { charttype: 6 } });
    expect(res.data.saved).toBe(true);
    const sent = (posts[0] as Array<Record<string, unknown>>)[0];
    expect(sent).toMatchObject({ name: "MCP TEST | Copy", group_id: 6, charttype: 6, sql: report.sql });
    expect(sent).not.toHaveProperty("id");
    expect(sent).not.toHaveProperty("guid");
    expect(res.data.items[0].id).toBe(99);
  });

  it("refuses SQL with -- comments", async () => {
    const posts: unknown[] = [];
    stub(posts);
    const { call } = harness(singleEnv({ HALO_MODE: "write" }));
    const res = await call("halo_reports_clone", { id: 30, name: "MCP TEST | Bad", overrides: { sql: "select 1 -- note" } });
    expect(res.data.error).toMatch(/-- comment/);
    expect(posts).toHaveLength(0);
  });

  it("lists report groups and creates only missing ones", async () => {
    const posts: unknown[] = [];
    stub(posts);
    const { call } = harness(singleEnv({ HALO_MODE: "write" }));
    expect((await call("halo_report_groups_list")).data.groups).toEqual(groups);
    const res = await call("halo_report_groups_create", { names: ["MCP TEST | Group", "MCP TEST | New"] });
    expect(posts[0]).toEqual([{ lookupid: 41, name: "MCP TEST | New" }]);
    expect(res.data.already_existed).toEqual([groups[0]]);
    const again = await call("halo_report_groups_create", { names: ["mcp test | group"] });
    expect(again.data.saved).toBe(false);
    expect(posts).toHaveLength(1);
  });
});

describe("dashboard builder", () => {
  it("checks the 12 column grid", () => {
    expect(checkGrid([{ label: "a", x: 0, y: 0, w: 6, h: 2 }, { label: "b", x: 6, y: 0, w: 6, h: 2 }])).toEqual([]);
    expect(checkGrid([{ label: "a", x: 0, y: 0, w: 7, h: 2 }, { label: "b", x: 6, y: 1, w: 6, h: 2 }])).toEqual(["a overlaps b"]);
    expect(checkGrid([{ label: "a", x: 8, y: 0, w: 6, h: 2 }])[0]).toMatch(/past the 12 column grid/);
  });

  it("builds a new dashboard with an lg layout string and all agent access", async () => {
    const posts: unknown[] = [];
    stub(posts);
    const { call } = harness(singleEnv({ HALO_MODE: "write" }));
    const res = await call("halo_dashboard_build", {
      name: "MCP TEST | Board",
      widgets: [
        { title: "Chart", type: "report_chart", report_id: 30, x: 0, y: 0, w: 8, h: 4 },
        { title: "Count", type: "ticket_counter", x: 8, y: 0, w: 4, h: 2 },
      ],
    });
    expect(res.data.saved).toBe(true);
    const sent = (posts[0] as Array<Record<string, unknown>>)[0];
    expect(sent.widgets).toEqual([
      { title: "Chart", type: 1, report_id: 30, seq: 1 },
      { title: "Count", type: 7, seq: 2 },
    ]);
    expect(JSON.parse(sent.layouts as string)).toEqual({ lg: [{ i: "new0", x: 0, y: 0, w: 8, h: 4 }, { i: "new1", x: 8, y: 0, w: 4, h: 2 }] });
    expect(sent.access_control).toEqual([{ agent_id: -9999, level: 1 }]);
  });

  it("refuses overlapping widgets before calling Halo", async () => {
    const posts: unknown[] = [];
    const http = stub(posts);
    const { call } = harness(singleEnv({ HALO_MODE: "write" }));
    const res = await call("halo_dashboard_build", { name: "MCP TEST | Bad", widgets: [{ type: 1, x: 0, y: 0, w: 6, h: 2 }, { type: 2, x: 5, y: 0, w: 2, h: 2 }] });
    expect(res.data.error).toMatch(/overlaps/);
    expect(http.calls).toHaveLength(0);
  });

  it("updates an existing dashboard, keeping other widgets, breakpoints and checking against them", async () => {
    const posts: unknown[] = [];
    stub(posts);
    const { call } = harness(singleEnv({ HALO_MODE: "write" }));
    const clash = await call("halo_dashboard_build", { id: 4, name: "MCP TEST | Dashboard", widgets: [{ type: 7, x: 3, y: 0, w: 3, h: 2 }] });
    expect(clash.data.error).toMatch(/existing widget 1/);

    const res = await call("halo_dashboard_build", { id: 4, name: "MCP TEST | Dashboard", widgets: [{ title: "New", type: 7, x: 6, y: 0, w: 6, h: 2 }], dry_run: true, show_payload: true });
    const payload = res.data.items[0].payload;
    expect(payload.widgets).toEqual([{ id: 1, type: 1, report_id: 30, title: "Existing" }, { title: "New", type: 7, seq: 1 }]);
    const layouts = JSON.parse(payload.layouts);
    expect(layouts.md).toEqual([{ i: "1", x: 0, y: 0, w: 5, h: 4 }]);
    expect(layouts.lg).toEqual([{ i: "1", x: 0, y: 0, w: 6, h: 4 }, { i: "new0", x: 6, y: 0, w: 6, h: 2 }]);
    expect(payload.access_control).toEqual([{ agent_id: -9999, level: 1 }]);
    expect(posts).toHaveLength(0);
  });
});
