/**
 * HaloForge MCP | Tool Registry
 *
 * Builds every tool, registers only those the configured instances allow
 * (read mode registers no create or update tools; delete tools need full mode
 * and HALO_DISABLE_DELETE=false), adds the optional instance argument and
 * checks the selected instance's mode and allowlist on every call.
 */

import { z, ZodRawShape } from "zod";
import { InstanceManager } from "../client/instance-manager.js";
import { createResourceTools, ToolDefinition, ToolResult, errorResult, successResult } from "./resource-factory.js";
import { createApiRequestTool } from "./api-request.js";
import { catalogueConfigs } from "./resources/config-catalogue.js";
import { createLayoutTools } from "./config/layouts.js";
import { createReportTools } from "./config/reports.js";
import { createDashboardTools } from "./config/dashboards.js";
import { createDiagnosticTools } from "./config/diagnostics.js";
import { AuditLog } from "../safety/audit.js";
import { ToolAccess, canDelete, canWrite, checkAccess, shouldRegister } from "../safety/policy.js";

// Original resource configs
import { createTicketsConfig } from "./resources/tickets.js";
import { actionsConfig } from "./resources/actions.js";
import { createAgentsConfig } from "./resources/agents.js";
import { assetsConfig } from "./resources/assets.js";
import { clientsConfig } from "./resources/clients.js";
import { usersConfig } from "./resources/users.js";
import { sitesConfig } from "./resources/sites.js";
import { contractsConfig } from "./resources/contracts.js";
import { attachmentsConfig } from "./resources/attachments.js";
import { appointmentsConfig } from "./resources/appointments.js";
import { invoicesConfig } from "./resources/invoices.js";
import { itemsConfig } from "./resources/items.js";
import { knowledgeBaseConfig } from "./resources/knowledge-base.js";
import { opportunitiesConfig } from "./resources/opportunities.js";
import { projectsConfig } from "./resources/projects.js";
import { quotesConfig } from "./resources/quotes.js";
import { reportsConfig } from "./resources/reports.js";
import { statusConfig } from "./resources/status.js";
import { suppliersConfig } from "./resources/suppliers.js";
import { teamsConfig } from "./resources/teams.js";
import { ticketTypesConfig } from "./resources/ticket-types.js";

// Must-Have additions
import { categoriesConfig } from "./resources/categories.js";
import { slaConfig } from "./resources/sla.js";
import { prioritiesConfig } from "./resources/priorities.js";
import { workflowsConfig } from "./resources/workflows.js";
import { assetTypesConfig } from "./resources/asset-types.js";
import { assetGroupsConfig } from "./resources/asset-groups.js";
import { softwareLicencesConfig } from "./resources/software-licences.js";
import { ticketRulesConfig } from "./resources/ticket-rules.js";
import { organisationsConfig } from "./resources/organisations.js";
import { topLevelConfig } from "./resources/top-level.js";

// Should-Have additions
import { timesheetsConfig } from "./resources/timesheets.js";
import { holidaysConfig } from "./resources/holidays.js";
import { workdaysConfig } from "./resources/workdays.js";
import { fieldsConfig } from "./resources/fields.js";
import { cannedTextConfig } from "./resources/canned-text.js";
import { tagsConfig } from "./resources/tags.js";
import { feedbackConfig } from "./resources/feedback.js";
import { auditConfig } from "./resources/audit.js";
import { servicesConfig } from "./resources/services.js";
import { serviceStatusConfig } from "./resources/service-status.js";
import { purchaseOrdersConfig } from "./resources/purchase-orders.js";
import { downtimeConfig } from "./resources/downtime.js";

import { logger } from "../utils/logger.js";

export interface RegisteredTool {
  name: string;
  description: string;
  access: ToolAccess;
  shape: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

function createInstancesTool(): ToolDefinition {
  return {
    name: "halo_instances_list",
    description: "List the configured Halo instances with their safety settings (mode, delete, write allowlist). Never shows credentials.",
    inputSchema: z.object({}),
    access: "read",
    handler: async (_args, ctx) =>
      successResult({
        default_instance: ctx.manager.defaultName,
        instances: ctx.manager.allConfigs().map((c) => ({
          name: c.name,
          base_url: c.baseUrl,
          mode: c.mode,
          can_write: canWrite(c),
          can_delete: canDelete(c),
          write_allowlist: c.writeAllowlist ? [...c.writeAllowlist] : null,
        })),
      }),
  };
}

/** Every tool definition, before registration filtering. */
export function allToolDefinitions(): ToolDefinition[] {
  const allConfigs = [
    // Core ITSM
    createTicketsConfig(),
    actionsConfig,
    createAgentsConfig(),
    assetsConfig,
    clientsConfig,
    usersConfig,
    sitesConfig,
    contractsConfig,
    attachmentsConfig,
    appointmentsConfig,
    invoicesConfig,
    itemsConfig,
    knowledgeBaseConfig,
    opportunitiesConfig,
    projectsConfig,
    quotesConfig,
    reportsConfig,
    statusConfig,
    suppliersConfig,
    teamsConfig,
    ticketTypesConfig,

    // Must-Have additions
    categoriesConfig,
    slaConfig,
    prioritiesConfig,
    workflowsConfig,
    assetTypesConfig,
    assetGroupsConfig,
    softwareLicencesConfig,
    ticketRulesConfig,
    organisationsConfig,
    topLevelConfig,

    // Should-Have additions
    timesheetsConfig,
    holidaysConfig,
    workdaysConfig,
    fieldsConfig,
    cannedTextConfig,
    tagsConfig,
    feedbackConfig,
    auditConfig,
    servicesConfig,
    serviceStatusConfig,
    purchaseOrdersConfig,
    downtimeConfig,
  ];

  // Configuration resources from the catalogue not covered above
  allConfigs.push(...catalogueConfigs(new Set(allConfigs.map((c) => c.apiPath.toLowerCase()))));

  const tools: ToolDefinition[] = [];
  for (const config of allConfigs) tools.push(...createResourceTools(config));
  tools.push(
    createApiRequestTool(),
    createInstancesTool(),
    ...createLayoutTools(),
    ...createReportTools(),
    ...createDashboardTools(),
    ...createDiagnosticTools()
  );
  return tools;
}

/**
 * Wrap a tool so it resolves the instance and enforces the safety policy.
 */
export function wrapTool(tool: ToolDefinition, manager: InstanceManager, audit: AuditLog): RegisteredTool {
  const names = manager.names();
  const shape: ZodRawShape = {
    ...tool.inputSchema.shape,
    instance: z
      .string()
      .max(64)
      .optional()
      .describe(`Halo instance to use. Configured: ${names.join(", ")}. Default: ${manager.defaultName}.`),
  };
  return {
    name: tool.name,
    description: tool.description,
    access: tool.access,
    shape,
    handler: async (rawArgs) => {
      const { instance, ...args } = rawArgs as Record<string, unknown> & { instance?: string };
      let resolved;
      try {
        resolved = manager.resolve(instance);
      } catch (err) {
        return errorResult((err as Error).message);
      }
      const { access, resources } = tool.accessFor ? tool.accessFor(args) : { access: tool.access, resources: tool.resources };
      const dryRun = tool.supportsDryRun === true && access === "write" && args.dry_run === true;
      const refusal = checkAccess(access, resolved.config, resources ?? [], dryRun);
      if (refusal) return errorResult(refusal);
      return tool.handler(args, { ...resolved, audit, toolName: tool.name, manager });
    },
  };
}

function toPatterns(raw: string | undefined): RegExp[] | undefined {
  if (!raw || raw.trim() === "") return undefined;
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i"));
}

/**
 * Optional tool filters: HALO_TOOLS keeps only matching tools, HALO_TOOLS_EXCLUDE
 * drops matching tools. Comma separated names with * wildcards, for example
 * HALO_TOOLS=halo_ticket_type_layout_*,halo_report*,halo_dashboard*.
 */
export function toolFilter(env: NodeJS.ProcessEnv = process.env): (name: string) => boolean {
  const include = toPatterns(env.HALO_TOOLS);
  const exclude = toPatterns(env.HALO_TOOLS_EXCLUDE);
  return (name) => (!include || include.some((r) => r.test(name))) && !(exclude && exclude.some((r) => r.test(name)));
}

/**
 * Build the tools to register for the configured instances.
 */
export function buildAllTools(
  manager: InstanceManager,
  audit: AuditLog = new AuditLog(),
  env: NodeJS.ProcessEnv = process.env
): Map<string, RegisteredTool> {
  const instances = manager.allConfigs();
  const allowed = toolFilter(env);
  const toolMap = new Map<string, RegisteredTool>();
  const definitions = allToolDefinitions();
  for (const tool of definitions) {
    if (!shouldRegister(tool.access, instances)) continue;
    if (!allowed(tool.name) && tool.name !== "halo_instances_list") continue;
    if (toolMap.has(tool.name)) logger.warn(`Duplicate tool name: ${tool.name}. Overwriting.`);
    toolMap.set(tool.name, wrapTool(tool, manager, audit));
  }
  const modes = instances.map((i) => `${i.name}=${i.mode}${canDelete(i) ? "+delete" : ""}`).join(", ");
  logger.info(`Registered ${toolMap.size} of ${definitions.length} tools (instances: ${modes})`);
  return toolMap;
}
