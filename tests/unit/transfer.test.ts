import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Call, harness, json, mockFetch, twoInstanceEnv, TRIAL_URL, PROD_URL } from "../helpers.js";

type Obj = Record<string, unknown>;

/** A tiny in memory Halo per host. POST creates records with new IDs. */
function fakeHalo(seed: Record<string, Record<string, Obj[]>>) {
  const db: Record<string, Record<string, Obj[]>> = JSON.parse(JSON.stringify(seed));
  let nextId = 500;
  const posts: Array<{ host: string; path: string; body: Obj[] }> = [];
  const http = mockFetch((call: Call) => {
    const host = call.url.origin;
    const tables = db[host];
    if (!tables) return undefined;
    const [, , resource, id] = call.url.pathname.split("/");
    if (call.method === "POST") {
      const body = call.body as Obj[];
      posts.push({ host, path: resource, body });
      const saved = body.map((r) => {
        const list = (tables[resource] ??= []);
        if (r.id !== undefined) {
          const i = list.findIndex((x) => String(x.id) === String(r.id));
          list[i] = { ...list[i], ...r };
          return list[i];
        }
        const rec = { ...r, id: nextId++ };
        list.push(rec);
        return rec;
      });
      return saved.length === 1 ? saved[0] : saved;
    }
    let list = tables[resource];
    if (!list) return json({ message: "not found" }, 404);
    if (resource === "Lookup") list = list.filter((r) => String(r.lookupid) === call.url.searchParams.get("lookupid"));
    if (id) return list.find((r) => String(r.id) === id) ?? json({ message: "not found" }, 404);
    return { record_count: list.length, records: list };
  });
  return { db, posts, http };
}

const sourceSeed = {
  Lookup: [
    { id: 5, lookupid: 41, name: "MCP TEST | Group" },
    { id: 6, lookupid: 41, name: "MCP TEST | Other group" },
    { id: 70, lookupid: 12, name: "MCP TEST | Group" },
  ],
  Report: [
    { id: 30, guid: "g30", name: "MCP TEST | Open by team", group_id: 5, sql: "select 1", charttype: 0 },
    { id: 31, guid: "g31", name: "MCP TEST | Closed by team", group_id: 5, sql: "select 2", charttype: 6 },
    { id: 32, name: "MCP TEST | Elsewhere", group_id: 6, sql: "select 3" },
  ],
  DashboardLinks: [
    {
      id: 4,
      name: "MCP TEST | Board",
      widgets: [
        { id: 11, type: 1, report_id: 30, title: "Chart" },
        { id: 12, type: 7, team_id: 2, title: "Counter" },
      ],
      layouts: JSON.stringify({ lg: [{ i: "11", x: 0, y: 0, w: 8, h: 4 }, { i: "12", x: 8, y: 0, w: 4, h: 2 }] }),
      access_control: [{ agent_id: -9999, level: 1 }],
    },
  ],
  Team: [{ id: 2, name: "MCP TEST | Team" }],
  Status: [{ id: 1, name: "New" }],
  FieldInfo: [{ id: 10, name: "summary" }],
  TicketType: [{ id: 7, name: "MCP TEST | Incident", fields: [{ fieldid: 10, seq: 1 }], password: "hunter2-value" }],
};

const targetSeed = {
  Lookup: [{ id: 100, lookupid: 41, name: "MCP TEST | Already there" }],
  Report: [],
  DashboardLinks: [],
  Team: [{ id: 9, name: "MCP TEST | Team" }],
  Status: [{ id: 1, name: "New" }],
  FieldInfo: [{ id: 10, name: "summary" }],
  TicketType: [{ id: 3, name: "MCP TEST | Incident", fields: [{ fieldid: 10, seq: 2 }] }],
};

describe("config copy", () => {
  it("plans a report group with its reports and a dashboard, mapping references by name (dry run by default)", async () => {
    const { posts } = fakeHalo({ [TRIAL_URL]: sourceSeed, [PROD_URL]: targetSeed });
    const { call } = harness(twoInstanceEnv());
    const res = await call("halo_config_copy", {
      source_instance: "trial",
      target_instance: "prod",
      items: [{ resource: "ReportGroup", name: "MCP TEST | Group" }, { resource: "DashboardLinks", id: 4 }],
    });
    expect(res.isError).toBe(false);
    expect(res.data.dry_run).toBe(true);
    expect(res.data.summary).toEqual({ create: 4, update: 0, skip: 0, unresolved_references: 0 });
    expect(res.data.plan.map((p: Obj) => [p.resource, p.name, p.action])).toEqual([
      ["ReportGroup (Lookup 41)", "MCP TEST | Group", "create"],
      ["Report", "MCP TEST | Open by team", "create"],
      ["Report", "MCP TEST | Closed by team", "create"],
      ["DashboardLinks", "MCP TEST | Board", "create"],
    ]);
    const board = res.data.plan[3];
    expect(board.references).toEqual([
      { field: "widgets[0].report_id", type: "Report", source_id: 30, name: "MCP TEST | Open by team", target_id: "(new) MCP TEST | Open by team", status: "planned" },
      { field: "widgets[1].team_id", type: "Team", source_id: 2, name: "MCP TEST | Team", target_id: 9, status: "mapped" },
    ]);
    expect(res.data.plan[1].references[0]).toMatchObject({ field: "group_id", type: "ReportGroup", status: "planned" });
    expect(posts).toHaveLength(0);
  });

  it("applies the plan in order, chaining new IDs, and audits each write", async () => {
    const { posts, db } = fakeHalo({ [TRIAL_URL]: sourceSeed, [PROD_URL]: targetSeed });
    const { call, audit } = harness(twoInstanceEnv({ HALO_PROD_MODE: "write" }));
    const res = await call("halo_config_copy", {
      source_instance: "trial",
      target_instance: "prod",
      items: [{ resource: "ReportGroup", name: "MCP TEST | Group" }, { resource: "DashboardLinks", name: "MCP TEST | Board" }],
      dry_run: false,
    });
    expect(res.data.saved).toBe(true);
    expect(posts.every((p) => p.host === PROD_URL)).toBe(true);
    expect(posts.map((p) => p.path)).toEqual(["Lookup", "Report", "Report", "DashboardLinks"]);
    const groupId = (db[PROD_URL].Lookup.find((l) => l.name === "MCP TEST | Group") as Obj).id;
    const reports = db[PROD_URL].Report;
    expect(reports.map((r) => [r.name, r.group_id])).toEqual([["MCP TEST | Open by team", groupId], ["MCP TEST | Closed by team", groupId]]);
    expect(reports[0]).not.toHaveProperty("guid");
    const board = db[PROD_URL].DashboardLinks[0];
    expect(board.widgets).toEqual([
      { type: 1, report_id: reports[0].id, title: "Chart" },
      { type: 7, team_id: 9, title: "Counter" },
    ]);
    expect(JSON.parse(board.layouts as string).lg.map((l: Obj) => l.i)).toEqual(["new0", "new1"]);
    expect(readFileSync(audit, "utf8").trim().split("\n")).toHaveLength(4);
  });

  it("skips objects that already exist, or updates them on request, and never copies sensitive values", async () => {
    const { posts } = fakeHalo({ [TRIAL_URL]: sourceSeed, [PROD_URL]: targetSeed });
    const { call } = harness(twoInstanceEnv({ HALO_PROD_MODE: "write" }));
    const skip = await call("halo_config_copy", { source_instance: "trial", target_instance: "prod", items: [{ resource: "TicketType", id: 7 }] });
    expect(skip.data.plan[0]).toMatchObject({ action: "skip", target_id: 3 });
    const update = await call("halo_config_copy", {
      source_instance: "trial",
      target_instance: "prod",
      items: [{ resource: "TicketType", id: 7 }],
      on_existing: "update",
      dry_run: false,
    });
    expect(update.data.applied[0]).toMatchObject({ action: "update", target_id: 3 });
    expect(posts[0].body[0]).toEqual({ name: "MCP TEST | Incident", fields: [{ fieldid: 10, seq: 1 }], id: 3 });
  });

  it("refuses to apply with unresolved references, and refuses a read only target", async () => {
    const seed = JSON.parse(JSON.stringify(sourceSeed));
    seed.DashboardLinks[0].widgets[1].team_id = 99; // no such team on the source
    const { posts } = fakeHalo({ [TRIAL_URL]: seed, [PROD_URL]: targetSeed });
    const write = harness(twoInstanceEnv({ HALO_PROD_MODE: "write" }));
    const plan = await write.call("halo_config_copy", { source_instance: "trial", target_instance: "prod", items: [{ resource: "DashboardLinks", id: 4 }], include_dependencies: false });
    expect(plan.data.summary.unresolved_references).toBe(2);
    expect(plan.data.notice).toMatch(/could not be mapped/);
    const apply = await write.call("halo_config_copy", { source_instance: "trial", target_instance: "prod", items: [{ resource: "DashboardLinks", id: 4 }], include_dependencies: false, dry_run: false });
    expect(apply.data.error).toMatch(/Refusing to copy: 2 reference/);

    const readOnly = harness(twoInstanceEnv());
    const refused = await readOnly.call("halo_config_copy", { source_instance: "trial", target_instance: "prod", items: [{ resource: "Report", id: 30 }], dry_run: false });
    expect(refused.data.error).toMatch(/read mode/);
    expect(posts).toHaveLength(0);
  });
});

describe("config export, compare and document", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "haloforge-export-"));
    process.env.HALO_EXPORT_DIR = dir;
  });
  afterEach(() => {
    delete process.env.HALO_EXPORT_DIR;
  });

  it("exports one masked file per object with a manifest, inside the export folder only", async () => {
    fakeHalo({ [TRIAL_URL]: sourceSeed, [PROD_URL]: targetSeed });
    const { call } = harness(twoInstanceEnv());
    const res = await call("halo_config_export", { resources: ["TicketType", "Report"], folder: "trial_test" });
    expect(res.data).toMatchObject({ instance: "trial", folder: "trial_test", files: 4, resources: { TicketType: 1, Report: 3 } });
    expect(readdirSync(join(dir, "trial_test", "Report")).sort()).toEqual(["30_mcp_test_open_by_team.json", "31_mcp_test_closed_by_team.json", "32_mcp_test_elsewhere.json"]);
    const tt = JSON.parse(readFileSync(join(dir, "trial_test", "TicketType", "7_mcp_test_incident.json"), "utf8"));
    expect(tt.password).toBe("***");
    expect(JSON.parse(readFileSync(join(dir, "trial_test", "manifest.json"), "utf8")).resources.Report.count).toBe(3);
    const escape = await call("halo_config_export", { resources: ["Report"], folder: "../outside" });
    expect(escape.data.error).toMatch(/inside the export folder/);
    expect(existsSync(join(dir, "..", "outside"))).toBe(false);
  });

  it("compares two instances by name, ignoring IDs", async () => {
    fakeHalo({ [TRIAL_URL]: sourceSeed, [PROD_URL]: { ...targetSeed, Report: [{ id: 900, name: "MCP TEST | Open by team", group_id: 5, sql: "select 1", charttype: 1 }, { id: 901, name: "MCP TEST | Only here" }] } });
    const { call } = harness(twoInstanceEnv());
    const res = await call("halo_config_compare", { source_instance: "trial", target_instance: "prod", resources: ["Report", "Status", "TicketType"] });
    const byRes = Object.fromEntries(res.data.resources.map((r: Obj) => [r.resource, r]));
    expect(byRes.Report.missing_in_target).toEqual(["MCP TEST | Closed by team", "MCP TEST | Elsewhere"]);
    expect(byRes.Report.only_in_target).toEqual(["MCP TEST | Only here"]);
    expect(byRes.Report.different).toEqual([{ name: "MCP TEST | Open by team", source_id: 30, target_id: 900, change_count: 1, paths: ["charttype"] }]);
    expect(byRes.Status).toEqual({ resource: "Status", same: 1, identical: true });
    expect(byRes.TicketType.different[0].paths).toEqual(["fields[fieldid=10].seq"]);
    expect(res.data.totals).toEqual({ same: 1, different: 2, missing_in_target: 2, only_in_target: 1 });
  });

  it("compares an export against an instance", async () => {
    fakeHalo({ [TRIAL_URL]: sourceSeed, [PROD_URL]: targetSeed });
    const { call } = harness(twoInstanceEnv());
    await call("halo_config_export", { resources: ["Team"], folder: "snap" });
    const res = await call("halo_config_compare", { source_export: "snap", target_instance: "prod" });
    expect(res.data.source).toBe("export snap");
    expect(res.data.resources).toEqual([{ resource: "Team", same: 1, identical: true }]);
  });

  it("documents configuration as markdown, optionally to a file", async () => {
    fakeHalo({ [TRIAL_URL]: sourceSeed, [PROD_URL]: targetSeed });
    const { call, tools } = harness(twoInstanceEnv());
    const md = (await tools.get("halo_config_document")!.handler({ resources: ["TicketType", "Report"], title: "MCP TEST | Handover" })).content[0].text;
    expect(md).toContain("# MCP TEST | Handover");
    expect(md).toContain("| Tickets and layout | TicketType | 1 |");
    expect(md).toContain("| 7 | MCP TEST | Incident | 1 |".replace("MCP TEST | Incident", "MCP TEST \\| Incident"));
    const saved = await call("halo_config_document", { resources: ["Report"], file: "handover/config.md" });
    expect(saved.data.file).toBe(join("handover", "config.md"));
    expect(readFileSync(join(dir, "handover", "config.md"), "utf8")).toContain("### Report (Reporting > Reports)");
  });
});
