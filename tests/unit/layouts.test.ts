import { describe, it, expect } from "vitest";
import { harness, mockFetch, singleEnv } from "../helpers.js";

const fieldInfo = [
  { id: 10, name: "summary", label: "Summary" },
  { id: 11, name: "details", label: "Details" },
  { id: 12, name: "CFMcpTestReason", label: "MCP TEST | Reason" },
  { id: 13, name: "CFMcpTestImpact", label: "MCP TEST | Impact" },
];
const fieldGroups = [{ id: 1, name: "MCP TEST | Main" }, { id: 2, name: "MCP TEST | Extra" }];
const ticketType = {
  id: 7,
  name: "MCP TEST | Incident",
  fields: [
    { fieldid: 10, groupid: 1, seq: 1, techdetail: 1, endusernew: 1 },
    { fieldid: 11, groupid: 1, seq: 2, techdetail: 1, endusernew: 0 },
    { fieldid: 12, groupid: 2, seq: 3, techdetail: 2, restrictread: false },
  ],
  userfields: [{ fieldid: 10, seq: 1 }],
};
const fieldGroup = {
  id: 2,
  name: "MCP TEST | Extra",
  fields: [
    { id: 12, seq: 1, group_visibility_conditions: "" },
    { id: 13, seq: 2 },
  ],
  tickettypes: [{ id: 7, name: "MCP TEST | Incident" }],
};

function stub() {
  return mockFetch(({ method, url }) => {
    if (method !== "GET") return { id: 7 };
    if (url.pathname === "/api/FieldInfo") return { record_count: fieldInfo.length, records: fieldInfo };
    if (url.pathname === "/api/FieldGroup") return fieldGroups;
    if (url.pathname === "/api/TicketType/7") return ticketType;
    if (url.pathname === "/api/FieldGroup/2") return fieldGroup;
    return undefined;
  });
}

describe("ticket type layout", () => {
  it("reads the layout grouped and named", async () => {
    stub();
    const { call } = harness(singleEnv());
    const res = await call("halo_ticket_type_layout_get", { ticket_type_id: 7 });
    expect(res.data.ticket_type).toEqual({ id: 7, name: "MCP TEST | Incident" });
    expect(res.data.groups.map((g: { group_name: string; field_count: number }) => [g.group_name, g.field_count])).toEqual([
      ["MCP TEST | Main", 2],
      ["MCP TEST | Extra", 1],
    ]);
    expect(res.data.groups[0].fields[0]).toEqual({ fieldid: 10, name: "summary", label: "Summary", seq: 1, agent: { detail: 1 }, end_user: { new: 1 } });
    expect(res.data.groups[1].fields[0]).toMatchObject({ name: "CFMcpTestReason", restrict_read: false });
    expect(res.data.user_panel).toHaveLength(1);
  });

  it("changes fields by name, moves groups, reorders and removes, keeping the rest (dry run)", async () => {
    const http = stub();
    const { call } = harness(singleEnv({ HALO_MODE: "write" }));
    const res = await call("halo_ticket_type_layout_set", {
      ticket_type_id: 7,
      changes: [
        { field_name: "MCP TEST | Impact", group_name: "MCP TEST | Extra", seq: 4, techdetail: 1 },
        { fieldid: 12, remove: true },
      ],
      order: { fields: ["details", 10] },
      dry_run: true,
      show_payload: true,
    });
    expect(res.isError).toBe(false);
    const item = res.data.items[0];
    expect(item.payload.fields).toEqual([
      { fieldid: 10, groupid: 1, seq: 2, techdetail: 1, endusernew: 1 },
      { fieldid: 11, groupid: 1, seq: 1, techdetail: 1, endusernew: 0 },
      { fieldid: 13, seq: 4, techdetail: 1, groupid: 2 },
    ]);
    expect(item.changes.map((c: { path: string }) => c.path)).toEqual([
      "fields[fieldid=10].seq",
      "fields[fieldid=11].seq",
      "fields[fieldid=13]",
      "fields[fieldid=12]",
    ]);
    expect(http.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("saves in write mode with the full merged arrays", async () => {
    const http = stub();
    const { call } = harness(singleEnv({ HALO_MODE: "write" }));
    await call("halo_ticket_type_layout_set", { ticket_type_id: 7, user_panel_changes: [{ fieldid: 11, seq: 2 }] });
    const post = http.calls.find((c) => c.method === "POST")!;
    expect(post.url.pathname).toBe("/api/TicketType");
    expect(post.body).toEqual([{ id: 7, userfields: [{ fieldid: 10, seq: 1 }, { fieldid: 11, seq: 2 }] }]);
  });

  it("reports unknown and ambiguous names clearly", async () => {
    stub();
    const { call } = harness(singleEnv({ HALO_MODE: "write" }));
    const res = await call("halo_ticket_type_layout_set", { ticket_type_id: 7, changes: [{ field_name: "nope", seq: 1 }] });
    expect(res.data.error).toMatch(/No field named "nope"/);
    const reorder = await call("halo_ticket_type_layout_set", { ticket_type_id: 7, order: { fields: [13] } });
    expect(reorder.data.error).toMatch(/not in this layout/);
  });

  it("is not registered in read mode", () => {
    const { tools } = harness(singleEnv());
    expect(tools.has("halo_ticket_type_layout_get")).toBe(true);
    expect(tools.has("halo_ticket_type_layout_set")).toBe(false);
  });
});

describe("field groups", () => {
  it("reads fields with visibility conditions and where the group is used", async () => {
    stub();
    const { call } = harness(singleEnv());
    const res = await call("halo_field_group_get", { id: 2 });
    expect(res.data.field_group).toEqual({ id: 2, name: "MCP TEST | Extra" });
    expect(res.data.fields[0]).toMatchObject({ fieldid: 12, name: "CFMcpTestReason", group_visibility_conditions: "" });
    expect(res.data.used_by_ticket_types).toEqual([{ id: 7, name: "MCP TEST | Incident" }]);
  });

  it("matches on the key the group uses (id) and changes conditions and settings", async () => {
    stub();
    const { call } = harness(singleEnv({ HALO_MODE: "write" }));
    const res = await call("halo_field_group_set", {
      id: 2,
      settings: { name: "MCP TEST | Extra (renamed)" },
      changes: [{ fieldid: 13, group_visibility_conditions: "status=1", group_visibility_conditions_value: "1" }],
      dry_run: true,
      show_payload: true,
    });
    const item = res.data.items[0];
    expect(item.payload.fields).toEqual([
      { id: 12, seq: 1, group_visibility_conditions: "" },
      { id: 13, seq: 2, group_visibility_conditions: "status=1", group_visibility_conditions_value: "1" },
    ]);
    expect(item.changes.map((c: { path: string }) => c.path)).toEqual([
      "name",
      "fields[id=13].group_visibility_conditions",
      "fields[id=13].group_visibility_conditions_value",
    ]);
  });
});
