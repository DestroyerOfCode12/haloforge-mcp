/**
 * Integration tests against a HaloITSM trial instance.
 *
 *   RUN_INTEGRATION=1 npm run test:integration
 *
 * Reads the instance named by HALO_INTEGRATION_INSTANCE (default "trial") from
 * the usual HALO_<NAME>_* variables. Safety rules:
 *
 * * Nothing is ever deleted: delete is forced off for the whole run.
 * * The instance must be in write mode and must not be named like production.
 * * Only records whose current name starts with "MCP TEST |" are ever updated.
 * * Objects are found by name before being created, so reruns reuse them.
 *
 * Every object created or reused is listed in docs/test-objects.md at the end.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadInstances } from "../../src/types/config.js";
import { InstanceManager } from "../../src/client/instance-manager.js";
import { AuditLog } from "../../src/safety/audit.js";
import { buildAllTools, RegisteredTool } from "../../src/tools/registry.js";
import { CONFIG_RESOURCES } from "../../src/catalogue/config-resources.js";
import { configureProxy } from "../../src/utils/proxy.js";

const RUN = process.env.RUN_INTEGRATION === "1";
const INSTANCE = (process.env.HALO_INTEGRATION_INSTANCE || "trial").toLowerCase();
const PREFIX = "MCP TEST |";
const ALIAS = "copytarget";

type Obj = Record<string, unknown>;

/** Writable configuration resources that are safe to create a test object in. */
const SAFE_CREATE = [
  "TicketTypeGroup", "FieldGroup", "Tabs", "CannedText", "Template", "Outcome", "ViewFilter", "ViewColumns",
  "ViewListGroup", "Workflow", "ApprovalProcess", "CAB", "CABRole", "EmailTemplate", "SLA", "Workday", "Team",
  "Roles", "UserRoles", "ContactGroup", "Qualification", "ServiceCategory", "FAQLists", "StyleProfile",
  "AssetType", "AssetGroup", "PdfTemplate", "CSVTemplate", "Tags", "CostCentres", "ResourceType", "ReleaseType",
  "PipelineStages",
];

interface TestObject {
  resource: string;
  name: string;
  id?: unknown;
  status: string;
}
const objects: TestObject[] = [];

let tools: Map<string, RegisteredTool>;

async function call(name: string, args: Obj = {}): Promise<{ data: Obj; text: string; isError: boolean }> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  const result = await tool.handler({ instance: INSTANCE, ...args });
  const text = result.content[0].text;
  let data: Obj;
  try {
    data = JSON.parse(text);
  } catch {
    data = { text };
  }
  return { data, text, isError: result.isError === true };
}

import { allToolDefinitions } from "../../src/tools/registry.js";

/** Tool prefix per API resource, from the tool definitions (for example TicketType to halo_tickettypes). */
const PREFIXES = new Map<string, string>();
for (const def of allToolDefinitions()) {
  const m = def.name.match(/^(halo_.+)_list$/);
  const api = def.resources?.[0];
  if (m && api && !PREFIXES.has(api.toLowerCase())) PREFIXES.set(api.toLowerCase(), m[1]);
}

function toolPrefix(resource: string): string {
  const prefix = PREFIXES.get(resource.toLowerCase());
  if (!prefix) throw new Error(`No tools for ${resource}`);
  return prefix;
}

async function findByName(resource: string, name: string): Promise<Obj | undefined> {
  const res = await call(`${toolPrefix(resource)}_list`, { all_pages: true, max_items: 5000, fields: ["id", "name"] });
  if (res.isError) throw new Error(String(res.data.error));
  return (res.data.records as Obj[]).find((r) => String(r.name ?? "").toLowerCase() === name.toLowerCase());
}

/** Update a record only after checking it is a test object. */
async function safeUpdate(resource: string, id: unknown, data: Obj): Promise<{ data: Obj; isError: boolean }> {
  const current = await call(`${toolPrefix(resource)}_get`, { id, fields: ["id", "name"] });
  if (!String(current.data.name ?? "").startsWith(PREFIX)) throw new Error(`Refusing to update ${resource} ${id}: not a test object`);
  return call(`${toolPrefix(resource)}_upsert`, { data: { id, ...data } });
}

async function findOrCreate(resource: string, name: string, extra: Obj = {}): Promise<Obj> {
  const existing = await findByName(resource, name);
  if (existing) {
    objects.push({ resource, name, id: existing.id, status: "reused" });
    return existing;
  }
  const res = await call(`${toolPrefix(resource)}_upsert`, { data: { name, ...extra } });
  if (res.isError) {
    objects.push({ resource, name, status: `create failed: ${String(res.data.error).substring(0, 160)}` });
    throw new Error(String(res.data.error));
  }
  const id = (res.data.items as Obj[])[0].id;
  objects.push({ resource, name, id, status: "created" });
  return { id, name };
}

describe.skipIf(!RUN)("integration against the trial", () => {
  beforeAll(() => {
    if (/prod|live/.test(INSTANCE)) throw new Error(`Refusing to run integration tests against "${INSTANCE}"`);
    configureProxy();
    const env: NodeJS.ProcessEnv = { ...process.env, HALO_DISABLE_DELETE: "true" };
    const prefix = `HALO_${INSTANCE.toUpperCase()}_`;
    // A second, read only name for the same trial, so copy can be planned without a second server
    if (!process.env.HALO_INTEGRATION_TARGET) {
      env.HALO_INSTANCES = `${INSTANCE},${ALIAS}`;
      for (const k of ["BASE_URL", "CLIENT_ID", "CLIENT_SECRET", "SCOPE", "TENANT"]) {
        const v = process.env[`${prefix}${k}`];
        if (v) env[`HALO_${ALIAS.toUpperCase()}_${k}`] = v;
      }
      env[`HALO_${ALIAS.toUpperCase()}_MODE`] = "read";
    }
    const { instances } = loadInstances(env);
    const main = instances.find((i) => i.name === INSTANCE);
    if (!main) throw new Error(`Instance "${INSTANCE}" is not configured`);
    if (main.mode !== "write") throw new Error(`Instance "${INSTANCE}" must be in write mode (set ${prefix}MODE=write)`);
    if (instances.some((i) => i.disableDelete === false)) throw new Error("Delete must stay disabled");
    const manager = new InstanceManager(instances, INSTANCE);
    tools = buildAllTools(manager, new AuditLog(), env);
    expect([...tools.keys()].some((n) => n.endsWith("_delete"))).toBe(false);
  });

  afterAll(() => {
    if (!objects.length) return;
    const lines = [
      "# Test objects",
      "",
      `Objects created or reused by the integration tests on the trial (last run ${new Date().toISOString().substring(0, 10)}).`,
      "Nothing is deleted. Every name starts with `MCP TEST |`. Rerunning the tests reuses these objects.",
      "",
      "| Resource | Name | ID | Status |",
      "|---|---|---|---|",
      ...objects.map((o) => `| ${o.resource} | ${o.name.replace(/\|/g, "\\|")} | ${o.id ?? ""} | ${o.status.replace(/\|/g, "\\|")} |`),
      "",
    ];
    writeFileSync(resolve("docs/test-objects.md"), lines.join("\n"));
  });

  describe("read every matrix area", () => {
    it.each(CONFIG_RESOURCES.map((r) => [r.area, r.resource]))("%s: %s lists and reads", async (_area, resource) => {
      const prefix = toolPrefix(resource);
      const list = await call(`${prefix}_list`, { page_size: 3 });
      expect(list.isError, String(list.data.error)).toBe(false);
      const first = (list.data.records as Obj[] | undefined)?.[0];
      if (first?.id !== undefined) {
        const get = await call(`${prefix}_get`, { id: first.id, includedetails: true, fields: ["id"] });
        expect(get.isError, String(get.data.error)).toBe(false);
      }
    });
  });

  describe("create and update one test object per writable area", () => {
    it.each(SAFE_CREATE)("%s", async (resource) => {
      const name = `${PREFIX} ${resource}`;
      const obj = await findOrCreate(resource, name);
      const checked = `${name} (checked)`;
      const preview = await call(`${toolPrefix(resource)}_upsert`, { data: { id: obj.id, name: checked }, dry_run: true });
      expect(preview.data.items).toBeDefined();
      expect((preview.data.items as Obj[])[0].changes).toEqual([{ path: "name", before: name, after: checked }]);
      expect((await safeUpdate(resource, obj.id, { name: checked })).isError).toBe(false);
      expect((await call(`${toolPrefix(resource)}_get`, { id: obj.id, fields: ["name"] })).data.name).toBe(checked);
      expect((await safeUpdate(resource, obj.id, { name })).isError).toBe(false);
      expect((await call(`${toolPrefix(resource)}_get`, { id: obj.id, fields: ["name"] })).data.name).toBe(name);
    });
  });

  describe("ticket type layout round trip", () => {
    it("reorders two fields, reads it back and restores it", async (ctx) => {
      const tt = await findOrCreate("TicketType", `${PREFIX} Layout`);
      const before = await call("halo_ticket_type_layout_get", { ticket_type_id: tt.id });
      expect(before.isError, String(before.data.error)).toBe(false);
      const fields = (before.data.groups as Array<{ fields: Obj[] }>).flatMap((g) => g.fields);
      if (fields.length < 2) {
        ctx.skip();
        return;
      }
      const [a, b] = fields;
      const preview = await call("halo_ticket_type_layout_set", { ticket_type_id: tt.id, order: { fields: [b.fieldid, a.fieldid] }, dry_run: true });
      expect((preview.data.items as Obj[])[0].change_count).toBeGreaterThan(0);
      const set = await call("halo_ticket_type_layout_set", { ticket_type_id: tt.id, order: { fields: [b.fieldid, a.fieldid] } });
      expect(set.isError, String(set.data.error)).toBe(false);
      const after = await call("halo_ticket_type_layout_get", { ticket_type_id: tt.id });
      const order = (after.data.groups as Array<{ fields: Obj[] }>).flatMap((g) => g.fields).map((f) => f.fieldid);
      expect(order.indexOf(b.fieldid)).toBeLessThan(order.indexOf(a.fieldid));
      const restore = await call("halo_ticket_type_layout_set", { ticket_type_id: tt.id, order: { fields: [a.fieldid, b.fieldid] } });
      expect(restore.isError).toBe(false);
    });
  });

  describe("report group, report and dashboard: build, export, compare and copy (dry run)", () => {
    const groupName = `${PREFIX} Group`;
    const reportName = `${PREFIX} Report`;
    const dashboardName = `${PREFIX} Dashboard`;
    let reportId: unknown;
    let dashboardId: unknown;
    const folder = `integration_${Date.now()}`;

    it("creates the report group (idempotent)", async () => {
      const res = await call("halo_report_groups_create", { names: [groupName] });
      expect(res.isError, String(res.data.error)).toBe(false);
      const groups = (await call("halo_report_groups_list")).data.groups as Obj[];
      const g = groups.find((x) => x.name === groupName);
      expect(g).toBeDefined();
      objects.push({ resource: "Lookup (report group)", name: groupName, id: g!.id, status: res.data.saved ? "created" : "reused" });
    });

    it("clones a report into the group and runs it", async () => {
      const existing = await findByName("Report", reportName);
      if (existing) {
        reportId = existing.id;
        objects.push({ resource: "Report", name: reportName, id: reportId, status: "reused" });
      } else {
        const list = (await call("halo_reports_list", { page_size: 20, fields: ["id", "name"] })).data.records as Obj[];
        const source = list.find((r) => !String(r.name).startsWith(PREFIX));
        expect(source, "the trial needs at least one report to clone").toBeDefined();
        const res = await call("halo_reports_clone", { id: source!.id, name: reportName, group: groupName, overrides: { charttype: 0 } });
        expect(res.isError, String(res.data.error)).toBe(false);
        reportId = (res.data.items as Obj[])[0].id;
        objects.push({ resource: "Report", name: reportName, id: reportId, status: "created" });
      }
      const run = await call("halo_reports_run", { id: reportId, sample_rows: 1 });
      expect(run.isError, String(run.data.error)).toBe(false);
      expect(typeof run.data.row_count).toBe("number");
    });

    it("builds the dashboard", async () => {
      const existing = await findByName("DashboardLinks", dashboardName);
      const res = await call("halo_dashboard_build", {
        ...(existing ? { id: existing.id } : {}),
        name: dashboardName,
        replace_widgets: true,
        widgets: [
          { title: "Chart", type: "report_chart", report_id: reportId, x: 0, y: 0, w: 8, h: 4 },
          { title: "Counter", type: "report_counter", report_id: reportId, x: 8, y: 0, w: 4, h: 2 },
        ],
      });
      expect(res.isError, String(res.data.error)).toBe(false);
      dashboardId = existing?.id ?? (res.data.items as Obj[])[0].id;
      objects.push({ resource: "DashboardLinks", name: dashboardName, id: dashboardId, status: existing ? "reused" : "created" });
      const back = await call("halo_dashboardlinks_get", { id: dashboardId, includedetails: true });
      expect(JSON.parse(String(back.data.layouts)).lg).toHaveLength(2);
    });

    it("exports and compares the export against the trial", async () => {
      const exp = await call("halo_config_export", { resources: ["Report", "DashboardLinks"], folder });
      expect(exp.isError, String(exp.data.error)).toBe(false);
      const cmp = await call("halo_config_compare", { source_export: folder, target_instance: INSTANCE });
      expect(cmp.isError, String(cmp.data.error)).toBe(false);
      for (const r of cmp.data.resources as Obj[]) {
        expect((r.missing_in_target as string[] | undefined) ?? []).not.toContain(reportName);
        expect((r.missing_in_target as string[] | undefined) ?? []).not.toContain(dashboardName);
      }
    });

    it("plans a copy of the group and dashboard to a second instance (dry run)", async () => {
      const target = process.env.HALO_INTEGRATION_TARGET?.toLowerCase() ?? ALIAS;
      const res = await call("halo_config_copy", {
        source_instance: INSTANCE,
        target_instance: target,
        items: [{ resource: "ReportGroup", name: groupName }, { resource: "DashboardLinks", name: dashboardName }],
      });
      expect(res.isError, String(res.data.error)).toBe(false);
      expect(res.data.dry_run).toBe(true);
      const plan = res.data.plan as Obj[];
      expect(plan.map((p) => p.name)).toEqual(expect.arrayContaining([groupName, reportName, dashboardName]));
      expect((res.data.summary as Obj).unresolved_references).toBe(0);
      if (target === ALIAS) expect(plan.every((p) => p.action === "skip")).toBe(true);
    });
  });
});
