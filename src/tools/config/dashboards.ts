/**
 * HaloForge MCP | Dashboard builder
 *
 * halo_dashboard_build creates or updates a dashboard (/DashboardLinks) from a
 * simple grid description. It writes the 12 column Large layout ("lg" in the
 * layouts JSON string), keeps other breakpoints, checks widgets for overlaps
 * and grants all agents view access unless told otherwise.
 *
 * Widget types: 1 report chart, 2 report counter, 6 ticket list,
 * 7 ticket counter, 0 forecast.
 */

import { z } from "zod";
import {
  PlannedWrite,
  ToolDefinition,
  errorResult,
  executeWrites,
  readCurrent,
  successResult,
} from "../resource-factory.js";
import { diffRecord } from "../../safety/diff.js";
import { mergeRecord } from "../../safety/merge.js";

type Obj = Record<string, unknown>;

export const GRID_COLUMNS = 12;
export const ALL_AGENTS_ACCESS = { agent_id: -9999, level: 1 };

export const WIDGET_TYPES: Record<string, number> = {
  forecast: 0,
  report_chart: 1,
  report_counter: 2,
  ticket_list: 6,
  ticket_counter: 7,
};

export interface GridWidget {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Problems with a set of widget positions on the 12 column grid. */
export function checkGrid(widgets: Array<GridWidget & { label: string }>): string[] {
  const problems: string[] = [];
  for (const w of widgets) {
    if (w.x < 0 || w.y < 0) problems.push(`${w.label}: x and y must be 0 or more`);
    if (w.w < 1 || w.h < 1) problems.push(`${w.label}: w and h must be at least 1`);
    if (w.x + w.w > GRID_COLUMNS) problems.push(`${w.label}: x + w is ${w.x + w.w}, past the ${GRID_COLUMNS} column grid`);
  }
  for (let i = 0; i < widgets.length; i++) {
    for (let j = i + 1; j < widgets.length; j++) {
      const a = widgets[i];
      const b = widgets[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (overlap) problems.push(`${a.label} overlaps ${b.label}`);
    }
  }
  return problems;
}

function parseLayouts(raw: unknown): Obj {
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Obj) : {};
}

/** The array that holds widgets on an existing dashboard. */
export function widgetKeyOf(dashboard: Obj): string {
  if (Array.isArray(dashboard.widgets)) return "widgets";
  for (const [k, v] of Object.entries(dashboard)) {
    if (Array.isArray(v) && v.some((i) => i && typeof i === "object" && "type" in (i as Obj))) return k;
  }
  return "widgets";
}

const widgetSchema = z
  .object({
    id: z.number().int().optional().describe("Existing widget ID, to update that widget"),
    title: z.string().max(250).optional().describe("Widget title"),
    type: z
      .union([z.number().int(), z.enum(["forecast", "report_chart", "report_counter", "ticket_list", "ticket_counter"])])
      .describe("Widget type: report_chart (1), report_counter (2), ticket_list (6), ticket_counter (7) or forecast (0)"),
    report_id: z.number().int().optional().describe("Report ID for report widgets"),
    x: z.number().int().describe("Column, 0 to 11"),
    y: z.number().int().describe("Row"),
    w: z.number().int().describe("Width in columns, 1 to 12"),
    h: z.number().int().describe("Height in rows"),
    settings: z.record(z.unknown()).optional().describe("Any other widget values to send as given"),
  })
  .describe("A widget and its place on the 12 column grid");

export function createDashboardTools(): ToolDefinition[] {
  const build: ToolDefinition = {
    name: "halo_dashboard_build",
    description:
      "Create or update a dashboard from a grid description. Widgets are placed on the 12 column Large (lg) layout and checked for " +
      "overlaps; other breakpoints are kept. All agents can view it unless all_agents_can_view is false. Use dry_run: true first.",
    inputSchema: z.object({
      id: z.number().int().optional().describe("Existing dashboard ID to update; omit to create"),
      name: z.string().min(1).max(250).describe("Dashboard name"),
      widgets: z.array(widgetSchema).min(1).max(60).describe("Widgets with positions"),
      replace_widgets: z.boolean().optional().describe("When updating, replace all widgets instead of merging by widget id (default false)"),
      all_agents_can_view: z.boolean().optional().describe("Grant every agent view access (default true)"),
      settings: z.record(z.unknown()).optional().describe("Any other dashboard values to send as given"),
      dry_run: z.boolean().optional().describe("Preview without saving"),
      show_payload: z.boolean().optional().describe("Include the exact payload in the result"),
    }),
    access: "write",
    supportsDryRun: true,
    resources: ["DashboardLinks", "dashboardlinks"],
    handler: async (args, ctx) => {
      try {
        const input = args.widgets as Array<Obj & GridWidget>;
        const problems = checkGrid(input.map((w, n) => ({ ...w, label: `widget ${n + 1}${w.title ? ` (${w.title})` : ""}` })));
        if (problems.length) return errorResult(`Layout problems: ${problems.join("; ")}`);

        const id = args.id as number | undefined;
        const current = id !== undefined ? await readCurrent(ctx.client, "/DashboardLinks", id) : undefined;
        const widgetKey = current ? widgetKeyOf(current) : "widgets";

        const widgets = input.map((w, n) => {
          const type = typeof w.type === "string" ? WIDGET_TYPES[w.type] : w.type;
          const widget: Obj = {
            ...((w.settings as Obj) ?? {}),
            ...(w.id !== undefined ? { id: w.id } : {}),
            ...(w.title !== undefined ? { title: w.title } : {}),
            type,
            ...(w.report_id !== undefined ? { report_id: w.report_id } : {}),
            seq: n + 1,
          };
          return widget;
        });

        // Layout keys: the widget id when known, otherwise its position in the list
        const lgNew = input.map((w, n) => ({ i: String(w.id ?? `new${n}`), x: w.x, y: w.y, w: w.w, h: w.h }));
        const currentLayouts = parseLayouts(current?.layouts);
        // When merging, widgets not listed keep their place and must not be overlapped
        const kept =
          current && args.replace_widgets !== true && Array.isArray(currentLayouts.lg)
            ? (currentLayouts.lg as Array<GridWidget & { i: string }>).filter((item) => !lgNew.some((n) => n.i === String(item.i)))
            : [];
        const lg = [...kept, ...lgNew];
        if (kept.length) {
          const all = [
            ...kept.map((k) => ({ ...k, label: `existing widget ${k.i}` })),
            ...input.map((w, n) => ({ ...w, label: `widget ${n + 1}${w.title ? ` (${w.title})` : ""}` })),
          ];
          const clashes = checkGrid(all);
          if (clashes.length) return errorResult(`Layout problems with existing widgets: ${clashes.join("; ")}`);
        }
        const layouts = { ...currentLayouts, lg };

        const patch: Obj = {
          ...((args.settings as Obj) ?? {}),
          ...(id !== undefined ? { id } : {}),
          name: args.name,
          [widgetKey]: widgets,
          layouts: JSON.stringify(layouts),
        };
        if (args.all_agents_can_view !== false) {
          const existing = Array.isArray(current?.access_control) ? (current!.access_control as Obj[]) : [];
          const has = existing.some((a) => Number(a.agent_id) === ALL_AGENTS_ACCESS.agent_id);
          patch.access_control = has ? existing : [...existing, ALL_AGENTS_ACCESS];
        }

        let plan: PlannedWrite;
        if (current) {
          const { payload, warnings } = mergeRecord(current, patch, { [widgetKey]: ["id"], access_control: ["agent_id", "id"] }, {
            replaceArrays: args.replace_widgets === true ? [widgetKey] : [],
          });
          plan = { action: "update", id, name: current.name, payload, changes: diffRecord(current, payload, { [widgetKey]: ["id"] }), warnings };
        } else {
          plan = { action: "create", name: args.name, payload: patch, changes: diffRecord(undefined, patch), warnings: [] };
        }
        const result = await executeWrites(ctx, "/DashboardLinks", [plan], {
          dryRun: args.dry_run === true,
          showPayload: args.show_payload === true,
          resourceLabel: "DashboardLinks",
        });
        return successResult({ ...result, grid: { columns: GRID_COLUMNS, lg } });
      } catch (err) {
        return errorResult(`Failed to build dashboard: ${(err as Error).message}`);
      }
    },
  };
  return [build];
}
