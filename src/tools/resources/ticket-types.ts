/**
 * Ticket Types
 * Endpoint: /TicketType
 */

import { z } from "zod";
import { ResourceConfig } from "../resource-factory.js";

export const ticketTypesConfig: ResourceConfig = {
  name: "tickettypes",
  apiPath: "/TicketType",
  description: "ticket type",
  readPermission: "Agent",
  writePermission: "Admin",
  mergeRules: {
    fields: ["fieldid", "id"],
    userfields: ["fieldid", "id"],
  },
  listParams: {
    count: z.number().int().optional().describe("Number of results"),
  },
};
