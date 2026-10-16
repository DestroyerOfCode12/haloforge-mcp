/**
 * Workflows - Workflow definitions
 * Endpoint: /Workflow
 */

import { z } from "zod";
import { ResourceConfig } from "../resource-factory.js";

export const workflowsConfig: ResourceConfig = {
  name: "workflows",
  apiPath: "/Workflow",
  description: "workflow",
  readPermission: "Agent",
  writePermission: "Admin",
  mergeRules: {
    steps: ["id", "step_id"],
    stages: ["id"],
  },
  listParams: {
    includedetails: z.boolean().optional().describe("Include extra details"),
  },
};
