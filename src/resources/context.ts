/**
 * HaloForge MCP | MCP Resources (read only context)
 *
 * Provides contextual information about the default instance to MCP clients
 * without performing actions.
 */

import { InstanceManager } from "../client/instance-manager.js";
import { canDelete, canWrite } from "../safety/policy.js";
import { maskSecrets } from "../utils/secrets.js";

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: () => Promise<string>;
}

export function buildResources(manager: InstanceManager): McpResource[] {
  const { client } = manager.resolve();
  return [
    {
      uri: "halo://config/status",
      name: "Server Status",
      description: "Configured instances, safety modes and authentication state",
      mimeType: "application/json",
      handler: async () => {
        return JSON.stringify({
          default_instance: manager.defaultName,
          instances: manager.allConfigs().map((c) => ({
            name: c.name,
            base_url: c.baseUrl,
            mode: c.mode,
            can_write: canWrite(c),
            can_delete: canDelete(c),
            authenticated: manager.resolve(c.name).client.isAuthenticated(),
            scope: c.scope,
          })),
        }, null, 2);
      },
    },
    {
      uri: "halo://config/rate-limit",
      name: "Rate Limit Status",
      description: "Current API rate limit usage: used, remaining, window size",
      mimeType: "application/json",
      handler: async () => {
        return JSON.stringify(client.getRateLimitStatus(), null, 2);
      },
    },
    {
      uri: "halo://schema/statuses",
      name: "Status Values",
      description: "All available status values with their types",
      mimeType: "application/json",
      handler: async () => {
        try {
          const response = await client.list("/Status");
          return JSON.stringify(response.data, null, 2);
        } catch (err) {
          return JSON.stringify({ error: maskSecrets((err as Error).message) });
        }
      },
    },
    {
      uri: "halo://schema/teams",
      name: "Teams",
      description: "All teams for quick reference",
      mimeType: "application/json",
      handler: async () => {
        try {
          const response = await client.list("/Team");
          return JSON.stringify(response.data, null, 2);
        } catch (err) {
          return JSON.stringify({ error: maskSecrets((err as Error).message) });
        }
      },
    },
    {
      uri: "halo://schema/agents",
      name: "Agents",
      description: "Agent list for quick reference",
      mimeType: "application/json",
      handler: async () => {
        try {
          const response = await client.list("/Agent");
          return JSON.stringify(response.data, null, 2);
        } catch (err) {
          return JSON.stringify({ error: maskSecrets((err as Error).message) });
        }
      },
    },
    {
      uri: "halo://schema/ticket-types",
      name: "Ticket Types",
      description: "Available ticket types",
      mimeType: "application/json",
      handler: async () => {
        try {
          const response = await client.list("/TicketType");
          return JSON.stringify(response.data, null, 2);
        } catch (err) {
          return JSON.stringify({ error: maskSecrets((err as Error).message) });
        }
      },
    },
  ];
}
