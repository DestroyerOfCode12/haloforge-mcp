import { describe, it, expect } from "vitest";
import { harness, mockFetch, singleEnv } from "../helpers.js";
import { CONFIG_RESOURCES } from "../../src/catalogue/config-resources.js";
import { allToolDefinitions, toolFilter } from "../../src/tools/registry.js";

describe("configuration coverage", () => {
  it("has list and get tools for every catalogue resource, and no write tools for read only ones", () => {
    const defs = allToolDefinitions();
    const byPath = new Map<string, string[]>();
    for (const d of defs) {
      const m = d.name.match(/^halo_(.+)_(list|get|upsert|delete)$/);
      if (m) byPath.set(m[1], [...(byPath.get(m[1]) ?? []), m[2]]);
    }
    const resources = new Set(defs.flatMap((d) => d.resources ?? []).map((r) => r.toLowerCase()));
    for (const r of CONFIG_RESOURCES) expect(resources.has(r.resource.toLowerCase()), r.resource).toBe(true);
    expect(byPath.get("tickettypefield")).toEqual(["list", "get"]);
    expect(byPath.get("workflowstep")).toEqual(["list", "get"]);
    expect(byPath.get("fieldgroup")).toEqual(["list", "get", "upsert", "delete"]);
    expect(byPath.has("tickettype")).toBe(false); // already served by halo_tickettypes_*
  });

  it("passes extra_params through", async () => {
    const http = mockFetch(() => []);
    const { call } = harness(singleEnv());
    await call("halo_contracts_list", { extra_params: { client_id: 12, includeinactive: true } });
    expect(http.calls[0].url.searchParams.get("client_id")).toBe("12");
    expect(http.calls[0].url.searchParams.get("includeinactive")).toBe("true");
    expect(http.calls[0].url.searchParams.has("extra_params")).toBe(false);
  });

  it("filters tools by name", () => {
    const f = toolFilter({ HALO_TOOLS: "halo_report*", HALO_TOOLS_EXCLUDE: "*_delete" });
    expect([f("halo_reports_list"), f("halo_reports_delete"), f("halo_tickets_list")]).toEqual([true, false, false]);
    const { tools } = harness(singleEnv({ HALO_TOOLS: "halo_report*" }));
    expect([...tools.keys()].every((n) => n.startsWith("halo_report") || n === "halo_instances_list")).toBe(true);
  });
});

describe("diagnostics", () => {
  it("probes the shape of an odd endpoint without returning values", async () => {
    mockFetch(({ url }) => {
      if (url.pathname === "/api/Automation") return { record_count: 1, automations: [{ id: 3, name: "MCP TEST | Secret name", steps: [] }] };
      if (url.pathname === "/api/Automation/3") return { id: 3, name: "MCP TEST | Secret name", steps: [{ id: 1, action: 2 }] };
      return undefined;
    });
    const { call } = harness(singleEnv());
    const res = await call("halo_config_probe", { resource: "Automation" });
    expect(res.text).not.toContain("Secret name");
    expect(res.data.list).toMatchObject({ ok: true, records_key: "automations", record_count: 1, first_record_fields: ["id", "name", "steps"] });
    expect(res.data.list.shape).toEqual({ type: "object", keys: { record_count: "number", automations: "array(1)" } });
    expect(res.data.detail).toEqual({ ok: true, id: 3, fields: ["id", "name", "steps"], nested: { steps: ["action", "id"] } });
  });

  it("reports a failing list without stopping", async () => {
    mockFetch(() => new Response(JSON.stringify({ message: "boom" }), { status: 400, headers: { "content-type": "application/json" } }));
    const { call } = harness(singleEnv());
    const res = await call("halo_config_probe", { resource: "Tenant" });
    expect(res.data.list.ok).toBe(false);
    expect(res.data.list.error).toMatch(/400.*boom/);
    expect((await call("halo_config_probe", { resource: "../x" })).data.error).toMatch(/single API resource/);
  });

  it("reads a resource from the API spec", async () => {
    const spec = {
      openapi: "3.0.1",
      paths: {
        "/api/FieldGroup": {
          get: {},
          post: { requestBody: { content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/FieldGroup" } } } } } },
        },
        "/api/FieldGroup/{id}": { get: {}, delete: {} },
        "/api/Report": { get: {} },
      },
      components: {
        schemas: {
          FieldGroup: {
            properties: {
              id: { type: "integer", format: "int32" },
              name: { type: "string" },
              fields: { type: "array", items: { $ref: "#/components/schemas/FieldGroupField" } },
            },
          },
        },
      },
    };
    const http = mockFetch(({ url }) => (url.pathname === "/api/swagger/v2/swagger.json" ? spec : undefined));
    const { call } = harness(singleEnv());
    const res = await call("halo_schema_get", { resource: "fieldgroup" });
    expect(res.data).toMatchObject({
      model: "FieldGroup",
      methods: { "/FieldGroup": ["GET", "POST"], "/FieldGroup/{id}": ["GET", "DELETE"] },
      fields: [
        { name: "id", type: "integer (int32)" },
        { name: "name", type: "string" },
        { name: "fields", type: "array of FieldGroupField" },
      ],
    });
    const list = await call("halo_schema_get", { list_resources: true });
    expect(list.data.resources).toEqual(["FieldGroup", "Report"]);
    expect(http.calls.filter((c) => c.url.pathname.includes("swagger"))).toHaveLength(1);
  });
});
