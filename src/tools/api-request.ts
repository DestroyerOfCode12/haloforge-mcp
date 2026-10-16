/**
 * HaloForge MCP | General API fallback
 *
 * halo_api_request reaches any Halo API path. GET always works; POST needs
 * the instance in write or full mode; DELETE needs full mode with
 * HALO_DISABLE_DELETE=false. Writes are audited.
 */

import { z } from "zod";
import { ToolDefinition, successResult, errorResult } from "./resource-factory.js";
import { ToolAccess } from "../safety/policy.js";
import { projectFields } from "../utils/output.js";

/** Normalise and validate a path: relative to /api, no scheme, no traversal. */
export function normaliseApiPath(raw: string): string {
  const path = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) {
    throw new Error("path must be relative to /api, for example /TicketType/1 (not a full URL)");
  }
  let p = path.startsWith("/") ? path : `/${path}`;
  p = p.replace(/^\/api(?=\/|$)/i, "");
  if (p === "") p = "/";
  if (p.split("/").some((seg) => seg === ".." || seg === ".")) throw new Error("path must not contain . or .. segments");
  if (p.includes("?") || p.includes("#")) throw new Error("put query parameters in query, not in path");
  return p;
}

function resourceOf(path: string): string {
  return path.split("/").filter(Boolean)[0] ?? "";
}

function accessForMethod(method: unknown): ToolAccess {
  if (method === "POST") return "write";
  if (method === "DELETE") return "delete";
  return "read";
}

export function createApiRequestTool(): ToolDefinition {
  return {
    name: "halo_api_request",
    description:
      "Send a request to any Halo API path (relative to /api) when no dedicated tool exists. GET is always allowed. " +
      "POST is allowed only when the instance is in write or full mode, and DELETE only in full mode with delete enabled. " +
      "POST bodies are sent as given (Halo upserts usually expect a list).",
    inputSchema: z.object({
      method: z.enum(["GET", "POST", "DELETE"]).default("GET").describe("HTTP method (default GET)"),
      path: z.string().min(1).max(500).describe("Path relative to /api, for example /TicketType/5 or /Lookup"),
      query: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])).optional().describe("Query parameters"),
      body: z.unknown().optional().describe("JSON body for POST"),
      fields: z.array(z.string().max(200)).max(200).optional().describe("Return only these fields"),
    }),
    access: "read",
    accessFor: (args) => {
      let resource = "";
      try {
        resource = resourceOf(normaliseApiPath(String(args.path ?? "")));
      } catch {
        // validation error is reported by the handler
      }
      return { access: accessForMethod(args.method ?? "GET"), resources: resource ? [resource] : [] };
    },
    handler: async (args, ctx) => {
      const method = (args.method as "GET" | "POST" | "DELETE") ?? "GET";
      let path: string;
      try {
        path = normaliseApiPath(String(args.path));
      } catch (err) {
        return errorResult((err as Error).message);
      }
      const resource = resourceOf(path);
      try {
        const response = await ctx.client.request({
          method,
          path,
          params: args.query as Record<string, unknown> | undefined,
          body: method === "POST" ? args.body ?? [] : undefined,
          rawBody: true,
        });
        if (method !== "GET") {
          ctx.audit.write({
            instance: ctx.config.name,
            tool: ctx.toolName,
            resource,
            action: "request",
            method,
            path,
            ids: [],
            status: "ok",
            records: Array.isArray(args.body) ? args.body.length : args.body !== undefined ? 1 : 0,
          });
        }
        return successResult(projectFields(response.data, args.fields as string[] | undefined));
      } catch (err) {
        if (method !== "GET") {
          ctx.audit.write({
            instance: ctx.config.name,
            tool: ctx.toolName,
            resource,
            action: "request",
            method,
            path,
            ids: [],
            status: "error",
            error: (err as Error).message,
          });
        }
        return errorResult((err as Error).message);
      }
    },
  };
}
