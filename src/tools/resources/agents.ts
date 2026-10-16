/**
 * Agents - Agent accounts, preferences, permissions
 * Endpoint: /Agent
 */

import { z } from "zod";
import { ResourceConfig, ToolDefinition, successResult, errorResult } from "../resource-factory.js";

export function createAgentsConfig(): ResourceConfig {
  const meToolDef: ToolDefinition = {
    name: "halo_agents_me",
    description: "Get the agent associated with the current access token. Halo permission: Agent.",
    inputSchema: z.object({}),
    access: "read",
    resources: ["Agent"],
    handler: async (_args, ctx) => {
      try {
        const response = await ctx.client.get("/Agent", "me");
        return successResult(response.data);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  };

  return {
    name: "agents",
    apiPath: "/Agent",
    description: "agent",
    readPermission: "Agent",
    writePermission: "Agent (update preferences), Admin (create/delete)",
    listParams: {
      team: z.number().int().optional().describe("Filter by team ID"),
      section_id: z.number().int().optional().describe("Filter by team/section ID"),
      department_id: z.number().int().optional().describe("Filter by department ID"),
      client_id: z.number().int().optional().describe("Filter by client access"),
      role: z.string().max(200).optional().describe("Filter by role"),
      includeenabled: z.boolean().optional().describe("Include enabled agents"),
      includedisabled: z.boolean().optional().describe("Include disabled agents"),
      includeunassigned: z.boolean().optional().describe("Include unassigned agent"),
      includedetails: z.boolean().optional().describe("Include extra objects (teams, roles)"),
    },
    customTools: [meToolDef],
  };
}
