/**
 * HaloForge MCP | Ticket type layouts and field groups
 *
 * halo_ticket_type_layout_get / _set read and change TicketType.fields[] (the
 * layout) and TicketType.userfields[] (the user panel) as a readable
 * structure. halo_field_group_get / _set do the same for FieldGroup.fields[].
 *
 * Changes go through the safe merge and dry run diff used by every upsert,
 * so a change to one field never drops the others.
 */

import { z } from "zod";
import { HaloClient } from "../../client/halo-client.js";
import {
  ToolDefinition,
  errorResult,
  executeWrites,
  planWrites,
  readCurrent,
  successResult,
  writeControlSchema,
} from "../resource-factory.js";
import { NamedItem, loadNames, resolveName } from "./lookups.js";

type Obj = Record<string, unknown>;

/** Known ticket type layout flags, shown under readable names. */
const AGENT_FLAGS: Record<string, string> = { techdetail: "detail", techaction: "action" };
const END_USER_FLAGS: Record<string, string> = { endusernew: "new", enduserdetail: "detail", enduseraction: "action" };
const OTHER_FLAGS: Record<string, string> = {
  restrictread: "restrict_read",
  restrictupdate: "restrict_update",
  override_fieldname: "override_fieldname",
  display_type: "display_type",
  mandatory: "mandatory",
};

const FIELD_KEYS = ["fieldid", "field_id", "id"];

/** The key the current items use for the field ID. */
export function fieldKeyOf(items: unknown[]): string {
  for (const k of FIELD_KEYS) {
    if (items.some((i) => i && typeof i === "object" && (i as Obj)[k] !== undefined && (i as Obj)[k] !== null)) return k;
  }
  return "fieldid";
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? undefined : n;
}

function pick(item: Obj, map: Record<string, string>): Obj | undefined {
  const out: Obj = {};
  for (const [raw, label] of Object.entries(map)) if (item[raw] !== undefined) out[label] = item[raw];
  return Object.keys(out).length ? out : undefined;
}

function describeField(item: Obj, key: string, fields: Map<number, NamedItem>, verbose: boolean): Obj {
  const id = num(item[key]);
  const info = id !== undefined ? fields.get(id) : undefined;
  const known = new Set([key, "groupid", "seq", ...Object.keys(AGENT_FLAGS), ...Object.keys(END_USER_FLAGS), ...Object.keys(OTHER_FLAGS)]);
  const out: Obj = {
    fieldid: id ?? item[key],
    name: info?.name ?? item.fieldname ?? item.name ?? null,
    ...(info?.label ? { label: info.label } : {}),
    seq: item.seq,
  };
  const agent = pick(item, AGENT_FLAGS);
  const endUser = pick(item, END_USER_FLAGS);
  const other = pick(item, OTHER_FLAGS);
  if (agent) out.agent = agent;
  if (endUser) out.end_user = endUser;
  if (other) Object.assign(out, other);
  if (verbose) {
    const rest: Obj = {};
    for (const [k, v] of Object.entries(item)) if (!known.has(k)) rest[k] = v;
    if (Object.keys(rest).length) out.other = rest;
  }
  return out;
}

function bySeq(a: Obj, b: Obj): number {
  return (num(a.seq) ?? 1e9) - (num(b.seq) ?? 1e9);
}

/** Group layout items by groupid, ordered by seq. */
export function readableLayout(items: unknown[], fields: Map<number, NamedItem>, groups: Map<number, NamedItem>, verbose = false) {
  const key = fieldKeyOf(items);
  const objs = items.filter((i): i is Obj => Boolean(i) && typeof i === "object").sort(bySeq);
  const byGroup = new Map<string, Obj[]>();
  for (const item of objs) {
    const g = String(item.groupid ?? "none");
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(item);
  }
  return [...byGroup.entries()].map(([g, list]) => {
    const gid = num(g);
    return {
      groupid: gid ?? null,
      group_name: gid !== undefined ? groups.get(gid)?.name ?? null : null,
      field_count: list.length,
      fields: list.map((i) => describeField(i, key, fields, verbose)),
    };
  });
}

const fieldChangeSchema = z
  .object({
    fieldid: z.number().int().optional().describe("Field ID"),
    field_name: z.string().max(200).optional().describe("Field name or label instead of fieldid"),
    group_name: z.string().max(200).optional().describe("Field group name instead of groupid"),
    remove: z.boolean().optional().describe("Take the field out of this layout (the field itself is not deleted)"),
  })
  .passthrough()
  .describe("A field change. Any other keys (seq, groupid, techdetail, techaction, endusernew, enduserdetail, enduseraction, restrictread, restrictupdate, override_fieldname, display_type and so on) are sent as given");

const orderSchema = z.object({
  fields: z.array(z.union([z.number().int(), z.string().max(200)])).min(1).max(500).describe("Field IDs or names in the new order"),
});

interface ChangeContext {
  client: HaloClient;
  fieldNames?: Map<number, NamedItem>;
  groupNames?: Map<number, NamedItem>;
}

async function fieldIdOf(ctx: ChangeContext, ref: number | string): Promise<number> {
  if (typeof ref === "number") return ref;
  if (/^\d+$/.test(ref)) return Number(ref);
  ctx.fieldNames ??= await loadNames(ctx.client, "/FieldInfo");
  return resolveName(ctx.fieldNames, ref, "field");
}

/** Turn readable changes into patch items for the merge helper. */
export async function buildFieldPatch(
  ctx: ChangeContext,
  current: unknown[],
  changes: Obj[] = [],
  order?: Array<number | string>
): Promise<Obj[]> {
  const key = fieldKeyOf(current);
  const patch: Obj[] = [];
  for (const change of changes) {
    const { fieldid, field_name, group_name, remove, ...rest } = change;
    const ref = (fieldid as number | undefined) ?? (field_name as string | undefined);
    if (ref === undefined) throw new Error("Each change needs fieldid or field_name");
    const id = await fieldIdOf(ctx, ref);
    const item: Obj = { ...rest, [key]: id };
    if (group_name !== undefined) {
      ctx.groupNames ??= await loadNames(ctx.client, "/FieldGroup");
      item.groupid = resolveName(ctx.groupNames, String(group_name), "field group");
    }
    if (remove === true) item._remove = true;
    patch.push(item);
  }

  if (order && order.length) {
    const ids = await Promise.all(order.map((r) => fieldIdOf(ctx, r)));
    const currentItems = current.filter((i): i is Obj => Boolean(i) && typeof i === "object");
    const seqs = ids
      .map((id) => currentItems.find((i) => Number(i[key]) === id))
      .map((i, n) => {
        if (!i) throw new Error(`Field ${ids[n]} is not in this layout, so it cannot be reordered`);
        return num(i.seq) ?? n + 1;
      })
      .sort((a, b) => a - b);
    // Reuse the same seq slots so fields outside the list keep their place
    const slots = new Set(seqs).size === seqs.length ? seqs : seqs.map((_, n) => (seqs[0] ?? 1) + n);
    ids.forEach((id, n) => {
      const existing = patch.find((p) => Number(p[key]) === id && p._remove !== true);
      if (existing) existing.seq = slots[n];
      else patch.push({ [key]: id, seq: slots[n] });
    });
  }
  return patch;
}

const TICKET_TYPE_RULES = { fields: ["fieldid", "field_id", "id"], userfields: ["fieldid", "field_id", "id"] };
const FIELD_GROUP_RULES = { fields: ["fieldid", "field_id", "id"] };

export function createLayoutTools(): ToolDefinition[] {
  const layoutGet: ToolDefinition = {
    name: "halo_ticket_type_layout_get",
    description:
      "Read a ticket type's layout as a readable structure: field groups in order, each field with its name, sequence, " +
      "agent and end user visibility flags, restrictions and display settings, plus the user panel. Values are shown as Halo returns them.",
    inputSchema: z.object({
      ticket_type_id: z.number().int().describe("Ticket type ID"),
      verbose: z.boolean().optional().describe("Also include every other setting on each field"),
    }),
    access: "read",
    resources: ["TicketType"],
    handler: async (args, ctx) => {
      try {
        const id = args.ticket_type_id as number;
        const tt = await readCurrent(ctx.client, "/TicketType", id);
        const [fields, groups] = await Promise.all([loadNames(ctx.client, "/FieldInfo"), loadNames(ctx.client, "/FieldGroup")]);
        const layout = Array.isArray(tt.fields) ? tt.fields : [];
        const userPanel = Array.isArray(tt.userfields) ? tt.userfields : [];
        return successResult({
          instance: ctx.config.name,
          ticket_type: { id: tt.id, name: tt.name },
          field_count: layout.length,
          groups: readableLayout(layout, fields, groups, args.verbose === true),
          user_panel: readableLayout(userPanel, fields, groups, args.verbose === true).flatMap((g) => g.fields),
          notice: "To change the layout use halo_ticket_type_layout_set (dry_run: true first).",
        });
      } catch (err) {
        return errorResult(`Failed to read ticket type layout: ${(err as Error).message}`);
      }
    },
  };

  const layoutSet: ToolDefinition = {
    name: "halo_ticket_type_layout_set",
    description:
      "Change a ticket type's layout: add fields, move them between groups, change visibility or restriction flags, " +
      "reorder, or take fields out (the field itself is never deleted). Fields can be named instead of using IDs. " +
      "Every other field is kept. Use dry_run: true to see the diff first.",
    inputSchema: z.object({
      ticket_type_id: z.number().int().describe("Ticket type ID"),
      changes: z.array(fieldChangeSchema).max(500).optional().describe("Changes to fields in the layout (TicketType.fields)"),
      order: orderSchema.optional().describe("Put these layout fields in this order, reusing their current sequence slots"),
      user_panel_changes: z.array(fieldChangeSchema).max(200).optional().describe("Changes to the user panel (TicketType.userfields)"),
      ...writeControlSchema,
    }),
    access: "write",
    supportsDryRun: true,
    resources: ["TicketType", "tickettypes"],
    handler: async (args, ctx) => {
      try {
        const id = args.ticket_type_id as number;
        const tt = await readCurrent(ctx.client, "/TicketType", id);
        const cc: ChangeContext = { client: ctx.client };
        const patchItem: Obj = { id };
        const changes = args.changes as Obj[] | undefined;
        const order = (args.order as { fields: Array<number | string> } | undefined)?.fields;
        if (changes?.length || order?.length) {
          patchItem.fields = await buildFieldPatch(cc, Array.isArray(tt.fields) ? tt.fields : [], changes, order);
        }
        const panel = args.user_panel_changes as Obj[] | undefined;
        if (panel?.length) patchItem.userfields = await buildFieldPatch(cc, Array.isArray(tt.userfields) ? tt.userfields : [], panel);
        if (!patchItem.fields && !patchItem.userfields) return errorResult("Nothing to change: pass changes, order or user_panel_changes");

        const plans = await planWrites(ctx.client, "/TicketType", [patchItem], {
          mergeRules: TICKET_TYPE_RULES,
          replaceArrays: args.replace_arrays as string[] | undefined,
          fullObject: args.full_object as boolean | undefined,
        });
        return successResult(
          await executeWrites(ctx, "/TicketType", plans, {
            dryRun: args.dry_run === true,
            showPayload: args.show_payload === true,
            resourceLabel: "TicketType",
          })
        );
      } catch (err) {
        return errorResult(`Failed to change ticket type layout: ${(err as Error).message}`);
      }
    },
  };

  const groupGet: ToolDefinition = {
    name: "halo_field_group_get",
    description:
      "Read a field group: its fields in order with names, sequence and visibility conditions, the group's own settings, " +
      "and the ticket types that use it.",
    inputSchema: z.object({
      id: z.number().int().describe("Field group ID"),
      verbose: z.boolean().optional().describe("Also include every other setting on each field"),
    }),
    access: "read",
    resources: ["FieldGroup"],
    handler: async (args, ctx) => {
      try {
        const group = await readCurrent(ctx.client, "/FieldGroup", args.id as number);
        const fields = await loadNames(ctx.client, "/FieldInfo");
        const items = (Array.isArray(group.fields) ? group.fields : []).filter((i): i is Obj => Boolean(i) && typeof i === "object").sort(bySeq);
        const key = fieldKeyOf(items);
        const verbose = args.verbose === true;
        const settings: Obj = {};
        for (const [k, v] of Object.entries(group)) {
          if (!Array.isArray(v) && (typeof v !== "object" || v === null)) settings[k] = v;
        }
        const tickettypes = Array.isArray(group.tickettypes)
          ? group.tickettypes.map((t) => (t && typeof t === "object" ? { id: (t as Obj).id ?? (t as Obj).tickettype_id, name: (t as Obj).name } : t))
          : [];
        return successResult({
          instance: ctx.config.name,
          field_group: settings,
          field_count: items.length,
          fields: items.map((i) => {
            const d = describeField(i, key, fields, verbose);
            for (const k of Object.keys(i)) if (/visibility/i.test(k)) d[k] = i[k];
            return d;
          }),
          used_by_ticket_types: tickettypes,
        });
      } catch (err) {
        return errorResult(`Failed to read field group: ${(err as Error).message}`);
      }
    },
  };

  const groupSet: ToolDefinition = {
    name: "halo_field_group_set",
    description:
      "Change a field group: rename it, change its own settings, add or reorder fields, change field visibility conditions, " +
      "or take fields out of the group (fields are never deleted). Every other field is kept. Use dry_run: true to see the diff first.",
    inputSchema: z.object({
      id: z.number().int().describe("Field group ID"),
      settings: z.record(z.unknown()).optional().describe("Group level values to change, for example { \"name\": \"MCP TEST | Group\" }"),
      changes: z.array(fieldChangeSchema).max(500).optional().describe("Changes to fields in the group (seq, group_visibility_conditions, group_visibility_conditions_value and so on)"),
      order: orderSchema.optional().describe("Put these fields in this order"),
      ...writeControlSchema,
    }),
    access: "write",
    supportsDryRun: true,
    resources: ["FieldGroup", "fieldgroup"],
    handler: async (args, ctx) => {
      try {
        const id = args.id as number;
        const group = await readCurrent(ctx.client, "/FieldGroup", id);
        const patchItem: Obj = { ...((args.settings as Obj) ?? {}), id };
        const changes = args.changes as Obj[] | undefined;
        const order = (args.order as { fields: Array<number | string> } | undefined)?.fields;
        if (changes?.length || order?.length) {
          patchItem.fields = await buildFieldPatch({ client: ctx.client }, Array.isArray(group.fields) ? group.fields : [], changes, order);
        }
        if (Object.keys(patchItem).length === 1) return errorResult("Nothing to change: pass settings, changes or order");
        const plans = await planWrites(ctx.client, "/FieldGroup", [patchItem], {
          mergeRules: FIELD_GROUP_RULES,
          replaceArrays: args.replace_arrays as string[] | undefined,
          fullObject: args.full_object as boolean | undefined,
        });
        return successResult(
          await executeWrites(ctx, "/FieldGroup", plans, {
            dryRun: args.dry_run === true,
            showPayload: args.show_payload === true,
            resourceLabel: "FieldGroup",
          })
        );
      } catch (err) {
        return errorResult(`Failed to change field group: ${(err as Error).message}`);
      }
    },
  };

  return [layoutGet, layoutSet, groupGet, groupSet];
}
