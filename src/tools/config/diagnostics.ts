/**
 * HaloForge MCP | Spec and shape diagnostics
 *
 * halo_schema_get     the API spec (swagger) definition of a resource: methods and fields
 * halo_config_probe   the shape of a resource's list and detail responses, without values
 *
 * The probe exists for endpoints with unexpected list shapes; it reports keys,
 * types and counts so the tools can be adjusted without exposing record data.
 */

import { z } from "zod";
import { HaloClient } from "../../client/halo-client.js";
import { ToolDefinition, errorResult, extraParamsSchema, successResult } from "../resource-factory.js";
import { extractRecords } from "../../utils/output.js";
import { describeRecord, describeResponse } from "../../utils/shape.js";

type Obj = Record<string, unknown>;

export const SPEC_PATH = "/swagger/v2/swagger.json";

const specCache = new WeakMap<HaloClient, Promise<Obj>>();

export function loadSpec(client: HaloClient): Promise<Obj> {
  let cached = specCache.get(client);
  if (!cached) {
    cached = client.request<Obj>({ method: "GET", path: SPEC_PATH, timeout: 120_000 }).then((r) => {
      if (!r.data || typeof r.data !== "object") throw new Error("The API spec was not JSON");
      return r.data;
    });
    cached.catch(() => specCache.delete(client));
    specCache.set(client, cached);
  }
  return cached;
}

function refName(schema: unknown): string | undefined {
  const ref = (schema as Obj | undefined)?.$ref;
  return typeof ref === "string" ? ref.split("/").pop() : undefined;
}

function typeLabel(schema: Obj | undefined): string {
  if (!schema) return "unknown";
  const ref = refName(schema);
  if (ref) return ref;
  if (schema.type === "array") return `array of ${typeLabel(schema.items as Obj | undefined)}`;
  const fmt = schema.format ? ` (${schema.format})` : "";
  return `${schema.type ?? "object"}${fmt}`;
}

function schemas(spec: Obj): Obj {
  return ((spec.components as Obj | undefined)?.schemas as Obj | undefined) ?? (spec.definitions as Obj | undefined) ?? {};
}

/** Methods and the request model for /api/{resource}, from the spec. */
export function describeResource(spec: Obj, resource: string) {
  const paths = (spec.paths as Obj | undefined) ?? {};
  const lower = resource.toLowerCase();
  const methods: Record<string, string[]> = {};
  let model: string | undefined;
  for (const [raw, ops] of Object.entries(paths)) {
    const path = raw.replace(/^\/api/i, "");
    const parts = path.split("/").filter(Boolean);
    if (parts[0]?.toLowerCase() !== lower) continue;
    methods[path] = Object.keys(ops as Obj).map((m) => m.toUpperCase());
    const post = (ops as Obj).post as Obj | undefined;
    const body = (((post?.requestBody as Obj | undefined)?.content as Obj | undefined)?.["application/json"] as Obj | undefined)?.schema as Obj | undefined;
    if (!model && parts.length === 1 && body) model = refName(body.type === "array" ? body.items : body);
  }
  const all = schemas(spec);
  if (!model) model = Object.keys(all).find((k) => k.toLowerCase() === lower);
  const def = model ? (all[model] as Obj | undefined) : undefined;
  const properties = Object.entries((def?.properties as Obj | undefined) ?? {}).map(([name, s]) => ({
    name,
    type: typeLabel(s as Obj),
    ...((s as Obj).description ? { description: (s as Obj).description } : {}),
  }));
  return { resource, model: model ?? null, methods, field_count: properties.length, fields: properties };
}

export function createDiagnosticTools(): ToolDefinition[] {
  const schema: ToolDefinition = {
    name: "halo_schema_get",
    description:
      "Look up a resource in the instance's API spec: the paths and methods it supports and the fields of its model with their types. " +
      "Pass list_resources: true to list every resource in the spec.",
    inputSchema: z.object({
      resource: z.string().max(100).optional().describe("API resource name, for example TicketType or FieldGroup"),
      list_resources: z.boolean().optional().describe("List every resource in the spec instead"),
      field_filter: z.string().max(100).optional().describe("Only fields whose name contains this text"),
    }),
    access: "read",
    handler: async (args, ctx) => {
      try {
        const spec = await loadSpec(ctx.client);
        if (args.list_resources === true || !args.resource) {
          const names = new Set<string>();
          for (const raw of Object.keys((spec.paths as Obj | undefined) ?? {})) {
            const first = raw.replace(/^\/api/i, "").split("/").filter(Boolean)[0];
            if (first && !first.startsWith("{")) names.add(first);
          }
          return successResult({ instance: ctx.config.name, openapi: spec.openapi ?? spec.swagger, resource_count: names.size, resources: [...names].sort() });
        }
        const info = describeResource(spec, String(args.resource));
        if (Object.keys(info.methods).length === 0 && !info.model) return errorResult(`"${args.resource}" is not in the API spec`);
        const filter = (args.field_filter as string | undefined)?.toLowerCase();
        if (filter) info.fields = info.fields.filter((f) => f.name.toLowerCase().includes(filter));
        return successResult({ instance: ctx.config.name, ...info });
      } catch (err) {
        return errorResult(`Failed to read the API spec: ${(err as Error).message}`);
      }
    },
  };

  const probe: ToolDefinition = {
    name: "halo_config_probe",
    description:
      "Describe the shape of a resource's responses without any record values: the list response's keys and types, the record count, " +
      "field names of the first record, and the field names of its detail record and nested child objects. Use it to diagnose endpoints " +
      "that list oddly or fail.",
    inputSchema: z.object({
      resource: z.string().min(1).max(100).describe("API resource name, for example Automation"),
      id: z.union([z.number().int(), z.string().max(100)]).optional().describe("Record to read in detail (default: the first listed)"),
      ...extraParamsSchema,
    }),
    access: "read",
    handler: async (args, ctx) => {
      const resource = String(args.resource).replace(/^\/+|\/+$/g, "");
      if (!/^[A-Za-z0-9_]+$/.test(resource)) return errorResult("resource must be a single API resource name");
      const out: Obj = { instance: ctx.config.name, resource };
      const params: Obj = { pageinate: true, page_size: 3, page_no: 1, count: 3, ...((args.extra_params as Obj) ?? {}) };
      let firstId: unknown = args.id;
      try {
        const list = await ctx.client.list(`/${resource}`, params);
        const page = extractRecords(list.data);
        out.list = {
          ok: true,
          shape: describeResponse(list.data),
          records_key: page.bare ? "(bare array)" : page.key ?? null,
          record_count: page.total ?? null,
          first_record_fields: page.records[0] && typeof page.records[0] === "object" ? Object.keys(page.records[0] as Obj).sort() : [],
        };
        if (firstId === undefined) firstId = (page.records[0] as Obj | undefined)?.id;
      } catch (err) {
        out.list = { ok: false, error: (err as Error).message };
      }
      if (firstId !== undefined && firstId !== null) {
        try {
          const detail = await ctx.client.get(`/${resource}`, firstId as number, { includedetails: true });
          out.detail =
            detail.data && typeof detail.data === "object" && !Array.isArray(detail.data)
              ? { ok: true, id: firstId, ...describeRecord(detail.data as Obj) }
              : { ok: true, id: firstId, shape: describeResponse(detail.data) };
        } catch (err) {
          out.detail = { ok: false, id: firstId, error: (err as Error).message };
        }
      }
      return successResult(out);
    },
  };

  return [schema, probe];
}
