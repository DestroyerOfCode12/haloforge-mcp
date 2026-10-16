/**
 * HaloForge MCP | Resource Tool Factory
 *
 * Generates standard MCP tools for Halo API resources: list, get, upsert and
 * delete. Handlers receive a context with the client for the selected
 * instance, so every tool works against any configured instance.
 *
 * Upsert tools accept one record or a list (sent in one API call), support
 * dry_run with a field by field diff, and merge nested arrays safely.
 */

import { z, ZodRawShape } from "zod";
import { HaloClient } from "../client/halo-client.js";
import { HaloConfig } from "../types/config.js";
import { ToolAccess, canDelete, canWrite } from "../safety/policy.js";
import { AuditLog } from "../safety/audit.js";
import { MergeRules, mergeRecord, isPlainObject } from "../safety/merge.js";
import { Change, diffRecord, summariseChanges } from "../safety/diff.js";
import { extractRecords, projectFields, renderList, renderObject } from "../utils/output.js";
import { maskSecrets } from "../utils/secrets.js";
import type { InstanceManager } from "../client/instance-manager.js";

export interface ToolContext {
  client: HaloClient;
  config: HaloConfig;
  audit: AuditLog;
  toolName: string;
  manager: InstanceManager;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<ZodRawShape>;
  /** What the tool can do; decides registration and the per instance check */
  access: ToolAccess;
  /** Resource names checked against the write allowlist */
  resources?: string[];
  /** The tool honours dry_run: true by only reading, so a dry run may run on any instance */
  supportsDryRun?: boolean;
  /** dry_run is assumed when the caller does not pass it */
  dryRunByDefault?: boolean;
  /** Argument naming the instance that is written to, when it is not "instance" */
  targetInstanceArg?: string;
  /** For tools whose access depends on the arguments (for example a raw API request) */
  accessFor?: (args: Record<string, unknown>) => { access: ToolAccess; resources?: string[] };
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ResourceConfig {
  /** MCP tool name prefix (for example "tickets" gives halo_tickets_list) */
  name: string;
  /** Halo API endpoint path (for example "/Tickets") */
  apiPath: string;
  /** Human readable resource description */
  description: string;
  /** Halo permission required for read operations */
  readPermission: string;
  /** Halo permission required for write operations */
  writePermission: string;
  listParams?: ZodRawShape;
  getParams?: ZodRawShape;
  upsertFields?: ZodRawShape;
  deleteParams?: ZodRawShape;
  /** Disable specific operations */
  disableOps?: Array<"list" | "get" | "upsert" | "delete">;
  /** Nested array match keys for the safe merge (array key to candidate keys) */
  mergeRules?: MergeRules;
  /** Query parameters used when reading the current record before a write */
  detailParams?: Record<string, unknown>;
  /** Custom tools beyond CRUD */
  customTools?: ToolDefinition[];
}

const MAX_BATCH = 100;
const DEFAULT_MAX_ITEMS = 1000;
const MAX_PAGES = 500;

export const outputSchema = {
  fields: z.array(z.string().max(200)).max(200).optional().describe("Return only these fields (dot paths allowed, for example 'fields.fieldid')"),
};

const paginationSchema = {
  page_size: z.number().int().min(1).max(100).optional().describe("Results per page (max 100, default 50)"),
  page_no: z.number().int().min(1).optional().describe("Page number (default 1)"),
  order: z.string().optional().describe("Field name to sort by"),
  orderdesc: z.boolean().optional().describe("Sort descending"),
  search: z.string().max(500).optional().describe("Free text search string"),
  pageinate: z.boolean().optional().describe("Enable pagination (default true)"),
  all_pages: z.boolean().optional().describe("Fetch every page and return all records (up to max_items)"),
  max_items: z.number().int().min(1).max(50_000).optional().describe(`Maximum records to return when all_pages is true (default ${DEFAULT_MAX_ITEMS})`),
  ...outputSchema,
};

const CONTROL_KEYS = new Set(["fields", "all_pages", "max_items", "instance", "dry_run", "merge", "replace_arrays", "full_object", "show_payload", "extra_params"]);

export const extraParamsSchema = {
  extra_params: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Any other Halo query parameters to send as given, for example { \"client_id\": 12 }"),
};

export function successResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: maskSecrets(renderObject(data)) }] };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text: maskSecrets(text) }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: maskSecrets(message) }) }], isError: true };
}

function queryParams(args: Record<string, unknown>, exclude: string[] = []): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (CONTROL_KEYS.has(key) || exclude.includes(key)) continue;
    if (value !== undefined && value !== null) params[key] = value;
  }
  const extra = args.extra_params as Record<string, unknown> | undefined;
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== null && params[key] === undefined) params[key] = value;
    }
  }
  return params;
}

export interface ListOptions {
  params?: Record<string, unknown>;
  allPages?: boolean;
  maxItems?: number;
}

export interface ListResult {
  records: unknown[];
  total: number;
  pageSize: number;
  pageNo: number;
  pagesFetched: number;
  truncated: boolean;
  bare: boolean;
  extra?: Record<string, unknown>;
}

/**
 * List records with optional paging through every page. Shared by the list
 * tools and the higher level tools.
 */
export async function listRecords(client: HaloClient, apiPath: string, options: ListOptions = {}): Promise<ListResult> {
  const params = { ...(options.params ?? {}) };
  if (params.pageinate === undefined) params.pageinate = true;
  const pageSize = (params.page_size as number) || 50;
  params.page_size = pageSize;
  let pageNo = (params.page_no as number) || 1;
  const startPage = pageNo;
  const maxItems = options.maxItems ?? (options.allPages ? DEFAULT_MAX_ITEMS : Number.POSITIVE_INFINITY);

  const records: unknown[] = [];
  let total = 0;
  let pagesFetched = 0;
  let bare = false;
  let extra: Record<string, unknown> | undefined;
  let truncated = false;

  for (;;) {
    params.page_no = pageNo;
    const response = await client.list(apiPath, params);
    pagesFetched++;
    const page = extractRecords(response.data);
    bare = page.bare;
    total = page.total ?? Math.max(total, records.length + page.records.length);
    if (pagesFetched === 1 && !page.bare && response.data && typeof response.data === "object") {
      // keep small top level values (for example report rows metadata), not the arrays
      extra = {};
      for (const [k, v] of Object.entries(response.data as Record<string, unknown>)) {
        if (k !== page.key && k !== "record_count" && !Array.isArray(v) && (typeof v !== "object" || v === null)) extra[k] = v;
      }
      if (Object.keys(extra).length === 0) extra = undefined;
    }

    for (const r of page.records) {
      if (records.length >= maxItems) {
        truncated = true;
        break;
      }
      records.push(r);
    }

    const done =
      !options.allPages ||
      truncated ||
      page.bare ||
      page.records.length === 0 ||
      page.records.length < pageSize ||
      (page.total !== undefined && records.length >= page.total) ||
      pagesFetched >= MAX_PAGES;
    if (done) {
      if (options.allPages && pagesFetched >= MAX_PAGES && page.records.length === pageSize) truncated = true;
      if (!options.allPages && records.length > maxItems) truncated = true;
      break;
    }
    pageNo++;
  }

  if (truncated && total < records.length) total = records.length;
  return { records, total, pageSize, pageNo: startPage, pagesFetched, truncated, bare, extra };
}

function paginationMeta(result: ListResult, allPages: boolean): Record<string, unknown> {
  if (allPages) {
    return {
      total_count: result.total,
      returned: result.records.length,
      pages_fetched: result.pagesFetched,
      has_more: result.truncated || result.records.length < result.total,
      ...(result.truncated ? { truncated_by_max_items: true } : {}),
    };
  }
  const totalPages = result.bare ? 1 : Math.max(1, Math.ceil(result.total / result.pageSize));
  return {
    total_count: result.total,
    returned: result.records.length,
    page_size: result.pageSize,
    page_no: result.pageNo,
    total_pages: totalPages,
    has_more: !result.bare && result.pageNo < totalPages,
  };
}

/** Read the current record before a write. */
export async function readCurrent(
  client: HaloClient,
  apiPath: string,
  id: number | string,
  detailParams: Record<string, unknown> = { includedetails: true }
): Promise<Record<string, unknown>> {
  const response = await client.get(apiPath, id, detailParams);
  if (!isPlainObject(response.data)) throw new Error(`Unexpected response reading ${apiPath}/${id}`);
  return response.data;
}

export interface PlannedWrite {
  action: "create" | "update";
  id?: number | string;
  name?: unknown;
  payload: Record<string, unknown>;
  changes: Change[];
  warnings: string[];
}

export interface PlanOptions {
  merge?: boolean;
  replaceArrays?: string[];
  fullObject?: boolean;
  mergeRules?: MergeRules;
  detailParams?: Record<string, unknown>;
}

function isExistingId(id: unknown): id is number | string {
  if (id === undefined || id === null || id === "") return false;
  const n = Number(id);
  return Number.isNaN(n) ? true : n > 0;
}

/** Work out what a write would change, reading current records for updates. */
export async function planWrites(
  client: HaloClient,
  apiPath: string,
  items: Record<string, unknown>[],
  options: PlanOptions = {}
): Promise<PlannedWrite[]> {
  const plans: PlannedWrite[] = [];
  for (const item of items) {
    if (isExistingId(item.id)) {
      const current = await readCurrent(client, apiPath, item.id, options.detailParams);
      const { payload, warnings } =
        options.merge === false
          ? { payload: item, warnings: [] as string[] }
          : mergeRecord(current, item, options.mergeRules, { replaceArrays: options.replaceArrays, fullObject: options.fullObject });
      plans.push({
        action: "update",
        id: item.id,
        name: current.name ?? current.summary ?? current.title,
        payload,
        changes: diffRecord(current, payload, options.mergeRules),
        warnings,
      });
    } else {
      plans.push({ action: "create", name: item.name ?? item.summary ?? item.title, payload: item, changes: diffRecord(undefined, item), warnings: [] });
    }
  }
  return plans;
}

function savedIds(data: unknown): Array<number | string> {
  const list = Array.isArray(data) ? data : [data];
  return list
    .map((r) => (isPlainObject(r) ? (r.id as number | string | undefined) : undefined))
    .filter((v): v is number | string => v !== undefined && v !== null);
}

export interface ExecuteOptions {
  dryRun: boolean;
  showPayload?: boolean;
  resourceLabel: string;
}

/**
 * Apply (or preview) planned writes. Unchanged updates are skipped. All
 * remaining records go in one POST. Every real write is audited.
 */
export async function executeWrites(
  ctx: ToolContext,
  apiPath: string,
  plans: PlannedWrite[],
  options: ExecuteOptions
): Promise<Record<string, unknown>> {
  const describe = (p: PlannedWrite, extra: Record<string, unknown> = {}) => ({
    action: p.action,
    ...(p.id !== undefined ? { id: p.id } : {}),
    ...(p.name !== undefined ? { name: p.name } : {}),
    change_count: p.changes.length,
    changes: p.changes,
    ...(p.warnings.length ? { warnings: p.warnings } : {}),
    ...(options.showPayload ? { payload: p.payload } : {}),
    ...extra,
  });

  if (options.dryRun) {
    return {
      dry_run: true,
      saved: false,
      instance: ctx.config.name,
      resource: options.resourceLabel,
      items: plans.map((p) => describe(p, p.action === "update" && p.changes.length === 0 ? { unchanged: true } : {})),
      notice: "Nothing was saved. Run again without dry_run to apply.",
    };
  }

  if (!canWrite(ctx.config)) {
    throw new Error(`Instance "${ctx.config.name}" is in ${ctx.config.mode} mode; nothing was saved.`);
  }

  const toSend = plans.filter((p) => p.action === "create" || p.changes.length > 0);
  const unchanged = plans.filter((p) => !toSend.includes(p));
  if (toSend.length === 0) {
    return {
      saved: false,
      instance: ctx.config.name,
      resource: options.resourceLabel,
      message: "No changes: every record already matches.",
      items: unchanged.map((p) => describe(p, { unchanged: true })),
    };
  }

  const resourceName = apiPath.replace(/^\//, "");
  let response;
  try {
    response = await ctx.client.post(apiPath, toSend.map((p) => p.payload));
  } catch (err) {
    for (const p of toSend) {
      ctx.audit.write({
        instance: ctx.config.name,
        tool: ctx.toolName,
        resource: resourceName,
        action: p.action,
        ids: p.id !== undefined ? [p.id] : [],
        status: "error",
        error: (err as Error).message,
        diff: summariseChanges(p.changes),
      });
    }
    throw err;
  }

  const ids = savedIds(response.data);
  toSend.forEach((p, i) => {
    const id = p.id ?? ids[i];
    ctx.audit.write({
      instance: ctx.config.name,
      tool: ctx.toolName,
      resource: resourceName,
      action: p.action,
      ids: id !== undefined ? [id] : [],
      status: "ok",
      diff: summariseChanges(p.changes),
    });
  });

  return {
    saved: true,
    instance: ctx.config.name,
    resource: options.resourceLabel,
    items: [
      ...toSend.map((p, i) => describe(p, p.id === undefined && ids[i] !== undefined ? { id: ids[i] } : {})),
      ...unchanged.map((p) => describe(p, { unchanged: true, skipped: true })),
    ],
    response: response.data,
  };
}

export const writeControlSchema = {
  dry_run: z.boolean().optional().describe("Preview only: read the current record and return a before and after diff without saving"),
  merge: z.boolean().optional().describe("Merge nested arrays into the current record by match key (default true). False sends data exactly as given"),
  replace_arrays: z.array(z.string()).max(50).optional().describe("Nested array keys to replace as given rather than merge"),
  full_object: z.boolean().optional().describe("Send the complete current record with the change applied (default false: send id, changed keys and complete nested arrays)"),
  show_payload: z.boolean().optional().describe("Include the exact payload in the result"),
};

const recordSchema = z
  .record(z.unknown())
  .refine((obj) => JSON.stringify(obj).length <= 512_000, { message: "Data object too large (max 512KB when serialised)" });

/**
 * Generate all CRUD tool definitions for a resource.
 */
export function createResourceTools(config: ResourceConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const disabled = config.disableOps || [];
  const resourceName = config.apiPath.replace(/^\//, "");
  const resources = [resourceName, config.name];

  if (!disabled.includes("list")) {
    tools.push({
      name: `halo_${config.name}_list`,
      description:
        `List or search ${config.description} records. Supports paging (or all_pages), sorting, filtering and choosing fields. ` +
        `Halo permission: ${config.readPermission}.`,
      inputSchema: z.object({ ...paginationSchema, ...extraParamsSchema, ...(config.listParams || {}) }),
      access: "read",
      resources,
      handler: async (args, ctx) => {
        try {
          const allPages = args.all_pages === true;
          const result = await listRecords(ctx.client, config.apiPath, {
            params: queryParams(args),
            allPages,
            maxItems: args.max_items as number | undefined,
          });
          const fields = args.fields as string[] | undefined;
          const envelope = {
            instance: ctx.config.name,
            pagination: paginationMeta(result, allPages),
            ...(result.extra ? { meta: result.extra } : {}),
            records: projectFields(result.records, fields),
          };
          return textResult(renderList(envelope));
        } catch (err) {
          return errorResult(`Failed to list ${config.description}: ${(err as Error).message}`);
        }
      },
    });
  }

  if (!disabled.includes("get")) {
    tools.push({
      name: `halo_${config.name}_get`,
      description: `Get a single ${config.description} by ID. Use fields to return only some fields. Halo permission: ${config.readPermission}.`,
      inputSchema: z.object({
        id: z.union([z.number().int(), z.string().max(100)]).describe(`The ${config.description} ID`),
        includedetails: z.boolean().optional().describe("Include related sub objects in the response"),
        ...outputSchema,
        ...extraParamsSchema,
        ...(config.getParams || {}),
      }),
      access: "read",
      resources,
      handler: async (args, ctx) => {
        try {
          const response = await ctx.client.get(config.apiPath, args.id as number, queryParams(args, ["id"]));
          return successResult(projectFields(response.data, args.fields as string[] | undefined));
        } catch (err) {
          return errorResult(`Failed to get ${config.description} ${args.id}: ${(err as Error).message}`);
        }
      },
    });
  }

  if (!disabled.includes("upsert")) {
    tools.push({
      name: `halo_${config.name}_upsert`,
      description:
        `Create or update ${config.description} records. Pass one object or a list (sent in one API call). ` +
        "Include 'id' to update; omit it to create. Updates read the current record first and merge nested arrays so " +
        "nothing is lost; use dry_run: true to see a field by field diff without saving. " +
        `Halo permission: ${config.writePermission}.`,
      inputSchema: z.object({
        data: z
          .union([recordSchema, z.array(recordSchema).min(1).max(MAX_BATCH)])
          .describe(`The ${config.description} record, or a list of up to ${MAX_BATCH} records.`),
        ...writeControlSchema,
        ...(config.upsertFields || {}),
      }),
      access: "write",
      supportsDryRun: true,
      resources,
      handler: async (args, ctx) => {
        try {
          const items = (Array.isArray(args.data) ? args.data : [args.data]) as Record<string, unknown>[];
          const plans = await planWrites(ctx.client, config.apiPath, items, {
            merge: args.merge as boolean | undefined,
            replaceArrays: args.replace_arrays as string[] | undefined,
            fullObject: args.full_object as boolean | undefined,
            mergeRules: config.mergeRules,
            detailParams: config.detailParams,
          });
          const result = await executeWrites(ctx, config.apiPath, plans, {
            dryRun: args.dry_run === true,
            showPayload: args.show_payload === true,
            resourceLabel: resourceName,
          });
          return successResult(result);
        } catch (err) {
          return errorResult(`Failed to upsert ${config.description}: ${(err as Error).message}`);
        }
      },
    });
  }

  if (!disabled.includes("delete")) {
    tools.push({
      name: `halo_${config.name}_delete`,
      description:
        `Delete a ${config.description} by ID. Only available when the instance is in full mode and HALO_DISABLE_DELETE=false. ` +
        `Halo permission: ${config.writePermission}.`,
      inputSchema: z.object({
        id: z.union([z.number().int(), z.string().max(100)]).describe(`The ${config.description} ID to delete`),
        ...(config.deleteParams || {}),
      }),
      access: "delete",
      resources,
      handler: async (args, ctx) => {
        const id = args.id as number | string;
        if (!canDelete(ctx.config)) return errorResult(`Delete is disabled on instance "${ctx.config.name}".`);
        try {
          await ctx.client.delete(config.apiPath, id, queryParams(args, ["id"]));
          ctx.audit.write({ instance: ctx.config.name, tool: ctx.toolName, resource: resourceName, action: "delete", ids: [id], status: "ok" });
          return successResult({ success: true, instance: ctx.config.name, message: `${config.description} ${id} deleted.` });
        } catch (err) {
          ctx.audit.write({
            instance: ctx.config.name,
            tool: ctx.toolName,
            resource: resourceName,
            action: "delete",
            ids: [id],
            status: "error",
            error: (err as Error).message,
          });
          return errorResult(`Failed to delete ${config.description} ${id}: ${(err as Error).message}`);
        }
      },
    });
  }

  if (config.customTools) tools.push(...config.customTools);
  return tools;
}
