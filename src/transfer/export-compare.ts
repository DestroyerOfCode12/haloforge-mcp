/**
 * HaloForge MCP | Configuration export, compare and document
 *
 * halo_config_export    chosen areas (or everything) to JSON, one file per object
 * halo_config_compare   two instances, or an export against an instance, matched by name
 * halo_config_document  a readable markdown summary of an instance's configuration
 *
 * Files are written under the export folder (HALO_EXPORT_DIR, default
 * ./exports, git ignored). Sensitive values (passwords, secrets, tokens) are
 * masked before anything is written.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { ToolDefinition, errorResult, successResult, textResult } from "../tools/resource-factory.js";
import { CONFIG_AREAS } from "../catalogue/config-resources.js";
import { diffRecord } from "../safety/diff.js";
import { redact } from "../utils/secrets.js";
import { maxOutputChars } from "../utils/output.js";
import { HaloClient } from "../client/halo-client.js";
import {
  IDENTITY_KEYS,
  Obj,
  exportRoot,
  fetchRecords,
  matchKeyOf,
  nameOf,
  normalise,
  readExport,
  safePath,
  selectResources,
  slug,
  writeJson,
} from "./common.js";

const selectionSchema = {
  areas: z
    .array(z.string().max(100))
    .max(20)
    .optional()
    .describe(`Areas to include: ${CONFIG_AREAS.join(", ")}, or all (default: all configuration)`),
  resources: z.array(z.string().max(100)).max(200).optional().describe("Individual API resources to include, for example TicketType"),
  include_data: z.boolean().optional().describe("Also include record like resources (agents, users, clients, sites, articles and so on) when selecting by area"),
  max_per_resource: z.number().int().min(1).max(20_000).optional().describe("Maximum records per resource (default 1000)"),
};

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").substring(0, 15);
}

export function createExportCompareTools(): ToolDefinition[] {
  const exportTool: ToolDefinition = {
    name: "halo_config_export",
    description:
      "Export configuration to JSON files, one file per object, grouped by resource, with a manifest. Choose areas or resources, or " +
      "export all configuration. Sensitive values are masked. Files go under the export folder (HALO_EXPORT_DIR, default ./exports).",
    inputSchema: z.object({
      ...selectionSchema,
      folder: z.string().max(200).optional().describe("Folder inside the export folder (default <instance>_<timestamp>)"),
      details: z.boolean().optional().describe("Read each record in full with includedetails (default true; slower but complete)"),
    }),
    access: "read",
    handler: async (args, ctx) => {
      try {
        const resources = selectResources({ areas: args.areas as string[], resources: args.resources as string[], includeData: args.include_data === true });
        const dir = safePath(args.folder as string | undefined, `${ctx.config.name}_${timestamp()}`);
        const summary: Record<string, Obj> = {};
        let files = 0;
        for (const res of resources) {
          const { records, error, truncated } = await fetchRecords(ctx.client, res.resource, {
            details: args.details !== false,
            maxItems: args.max_per_resource as number | undefined,
          });
          const used = new Set<string>();
          for (const record of records) {
            const base = `${record.id ?? "noid"}_${slug(nameOf(record) ?? "unnamed")}`;
            let file = `${base}.json`;
            for (let n = 2; used.has(file); n++) file = `${base}_${n}.json`;
            used.add(file);
            writeJson(join(dir, res.resource, file), redact(record));
            files++;
          }
          summary[res.resource] = { area: res.area, count: records.length, ...(truncated ? { truncated: true } : {}), ...(error ? { error } : {}) };
        }
        const manifest = {
          tool: "haloforge-mcp",
          instance: ctx.config.name,
          exported_at: new Date().toISOString(),
          details: args.details !== false,
          resources: summary,
        };
        writeJson(join(dir, "manifest.json"), manifest);
        const errors = Object.entries(summary).filter(([, v]) => v.error).map(([k, v]) => ({ resource: k, error: v.error }));
        return successResult({
          instance: ctx.config.name,
          folder: relative(exportRoot(), dir) || ".",
          files,
          resources: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.count])),
          ...(errors.length ? { errors } : {}),
        });
      } catch (err) {
        return errorResult(`Export failed: ${(err as Error).message}`);
      }
    },
  };

  const compareTool: ToolDefinition = {
    name: "halo_config_compare",
    description:
      "Compare configuration between two instances, or between an export folder and an instance. Records are matched by name; " +
      "the result lists, per resource, what is missing from the target, what exists only in the target and what differs (changed field paths). " +
      "IDs, GUIDs and dates are ignored.",
    inputSchema: z.object({
      source_instance: z.string().max(64).optional().describe("Instance to compare from"),
      source_export: z.string().max(200).optional().describe("Export folder (inside the export folder) to compare from, instead of an instance"),
      target_instance: z.string().max(64).describe("Instance to compare against"),
      ...selectionSchema,
      details: z.boolean().optional().describe("Compare full records with includedetails (default true)"),
      ignore_fields: z.array(z.string().max(100)).max(200).optional().describe("Extra field names to ignore"),
      max_paths: z.number().int().min(1).max(500).optional().describe("Changed paths to list per record (default 20)"),
    }),
    access: "read",
    handler: async (args, ctx) => {
      try {
        if (!args.source_instance && !args.source_export) return errorResult("Pass source_instance or source_export");
        const target = ctx.manager.resolve(args.target_instance as string);
        const details = args.details !== false;
        const ignore = new Set([...IDENTITY_KEYS, ...((args.ignore_fields as string[] | undefined) ?? []).map((f) => f.toLowerCase())]);
        const maxPaths = (args.max_paths as number | undefined) ?? 20;

        let sourceLabel: string;
        let fromExport: Map<string, Obj[]> | undefined;
        let sourceClient: HaloClient | undefined;
        let selection = selectResources({ areas: args.areas as string[], resources: args.resources as string[], includeData: args.include_data === true });
        if (args.source_export) {
          const dir = safePath(String(args.source_export), String(args.source_export));
          fromExport = readExport(dir).resources;
          sourceLabel = `export ${args.source_export}`;
          if (!args.areas && !args.resources) selection = selectResources({ resources: [...fromExport.keys()] });
        } else {
          sourceClient = ctx.manager.resolve(args.source_instance as string).client;
          sourceLabel = `instance ${String(args.source_instance).toLowerCase()}`;
        }

        const results: Obj[] = [];
        const totals = { same: 0, different: 0, missing_in_target: 0, only_in_target: 0 };
        for (const res of selection) {
          const max = args.max_per_resource as number | undefined;
          const source = fromExport ? { records: fromExport.get(res.resource) ?? [] } : await fetchRecords(sourceClient!, res.resource, { details, maxItems: max });
          const tgt = await fetchRecords(target.client, res.resource, { details, maxItems: max });
          if ("error" in source && source.error) {
            results.push({ resource: res.resource, error: `source: ${source.error}` });
            continue;
          }
          if (tgt.error) {
            results.push({ resource: res.resource, error: `target: ${tgt.error}` });
            continue;
          }
          const byKey = (list: Obj[]) => {
            const map = new Map<string, Obj>();
            const unnamed: unknown[] = [];
            const duplicates = new Set<string>();
            for (const r of list) {
              const key = matchKeyOf(res.resource, r);
              if (!key) unnamed.push(r.id);
              else if (map.has(key)) duplicates.add(nameOf(r)!);
              else map.set(key, r);
            }
            return { map, unnamed, duplicates: [...duplicates] };
          };
          const s = byKey(source.records);
          const t = byKey(tgt.records);
          const missing: string[] = [];
          const different: Obj[] = [];
          let same = 0;
          for (const [key, rec] of s.map) {
            const other = t.map.get(key);
            if (!other) {
              missing.push(nameOf(rec)!);
              continue;
            }
            const changes = diffRecord(normalise(other, ignore) as Obj, normalise(rec, ignore) as Obj);
            if (changes.length === 0) same++;
            else
              different.push({
                name: nameOf(rec),
                source_id: rec.id,
                target_id: other.id,
                change_count: changes.length,
                paths: changes.slice(0, maxPaths).map((c) => c.path),
              });
          }
          const onlyTarget = [...t.map.entries()].filter(([k]) => !s.map.has(k)).map(([, r]) => nameOf(r)!);
          totals.same += same;
          totals.different += different.length;
          totals.missing_in_target += missing.length;
          totals.only_in_target += onlyTarget.length;
          if (missing.length || different.length || onlyTarget.length || s.unnamed.length || s.duplicates.length || t.duplicates.length) {
            results.push({
              resource: res.resource,
              same,
              ...(missing.length ? { missing_in_target: missing } : {}),
              ...(onlyTarget.length ? { only_in_target: onlyTarget } : {}),
              ...(different.length ? { different } : {}),
              ...(s.unnamed.length ? { not_compared_without_name: s.unnamed.length } : {}),
              ...(s.duplicates.length || t.duplicates.length ? { duplicate_names: { source: s.duplicates, target: t.duplicates } } : {}),
            });
          } else {
            results.push({ resource: res.resource, same, identical: true });
          }
        }
        return successResult({ source: sourceLabel, target: `instance ${target.config.name}`, totals, resources: results });
      } catch (err) {
        return errorResult(`Compare failed: ${(err as Error).message}`);
      }
    },
  };

  const documentTool: ToolDefinition = {
    name: "halo_config_document",
    description:
      "Write a readable markdown summary of an instance's configuration for handover documents: per area, each resource with its " +
      "record count and the records by name, with sizes of nested lists (for example fields on a ticket type). Optionally saved to a file in the export folder.",
    inputSchema: z.object({
      ...selectionSchema,
      title: z.string().max(200).optional().describe("Document title"),
      file: z.string().max(200).optional().describe("Markdown file inside the export folder to write, for example handover/config.md"),
      details: z.boolean().optional().describe("Read each record in full to count nested items (default false; slower)"),
    }),
    access: "read",
    handler: async (args, ctx) => {
      try {
        const resources = selectResources({ areas: args.areas as string[], resources: args.resources as string[], includeData: args.include_data === true });
        const md = await documentInstance(ctx.client, ctx.config.name, resources, {
          title: args.title as string | undefined,
          details: args.details === true,
          maxItems: args.max_per_resource as number | undefined,
        });
        if (args.file) {
          const path = safePath(String(args.file), "configuration.md");
          if (!path.endsWith(".md")) return errorResult("file must end in .md");
          mkdirSync(resolve(path, ".."), { recursive: true });
          writeFileSync(path, md, "utf8");
          return successResult({ instance: ctx.config.name, file: relative(exportRoot(), path), characters: md.length, resources: resources.length });
        }
        const limit = maxOutputChars();
        if (md.length > limit) {
          return textResult(
            md.substring(0, md.lastIndexOf("\n## ", limit) > 0 ? md.lastIndexOf("\n## ", limit) : limit) +
              `\n\n> Notice: the document is ${md.length} characters, over the ${limit} character limit, so only the first sections are shown. ` +
              "Pass file to write the whole document, or choose fewer areas."
          );
        }
        return textResult(md);
      } catch (err) {
        return errorResult(`Document failed: ${(err as Error).message}`);
      }
    },
  };

  return [exportTool, compareTool, documentTool];
}

function cell(v: unknown): string {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").substring(0, 120);
}

/** Markdown summary of the selected resources. */
export async function documentInstance(
  client: HaloClient,
  instance: string,
  resources: ReturnType<typeof selectResources>,
  options: { title?: string; details?: boolean; maxItems?: number } = {}
): Promise<string> {
  const lines: string[] = [];
  lines.push(`# ${options.title ?? `Configuration summary (${instance})`}`, "");
  lines.push(`Generated by HaloForge MCP on ${new Date().toISOString().substring(0, 10)} from instance "${instance}".`, "");
  const byArea = new Map<string, typeof resources>();
  for (const r of resources) byArea.set(r.area, [...(byArea.get(r.area) ?? []), r]);

  const overview: string[] = ["| Area | Resource | Records |", "|---|---|---|"];
  const sections: string[] = [];
  for (const area of [...CONFIG_AREAS, ...[...byArea.keys()].filter((a) => !CONFIG_AREAS.includes(a as never))]) {
    const list = byArea.get(area);
    if (!list?.length) continue;
    sections.push(`## ${area}`, "");
    for (const res of list) {
      const { records, error, truncated } = await fetchRecords(client, res.resource, { details: options.details, maxItems: options.maxItems ?? 500 });
      overview.push(`| ${area} | ${res.resource} | ${error ? "error" : records.length}${truncated ? "+" : ""} |`);
      sections.push(`### ${res.resource}${res.uiPath ? ` (${res.uiPath.replace(/ \(to confirm\)$/, "")})` : ""}`, "");
      if (error) {
        sections.push(`Could not be read: ${error}`, "");
        continue;
      }
      if (records.length === 0) {
        sections.push("None configured.", "");
        continue;
      }
      const nestedKeys = [...new Set(records.flatMap((r) => Object.entries(r).filter(([, v]) => Array.isArray(v)).map(([k]) => k)))].slice(0, 4);
      const hasInactive = records.some((r) => "inactive" in r);
      const head = ["ID", "Name", ...(hasInactive ? ["Active"] : []), ...nestedKeys.map((k) => `${k} (count)`)];
      sections.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
      for (const r of records) {
        const row = [
          cell(r.id),
          cell(nameOf(r) ?? "(no name)"),
          ...(hasInactive ? [r.inactive ? "No" : "Yes"] : []),
          ...nestedKeys.map((k) => (Array.isArray(r[k]) ? String((r[k] as unknown[]).length) : "")),
        ];
        sections.push(`| ${row.join(" | ")} |`);
      }
      if (truncated) sections.push("", `Only the first ${records.length} records are listed.`);
      sections.push("");
    }
  }
  lines.push("## Overview", "", ...overview, "", ...sections);
  return lines.join("\n");
}
