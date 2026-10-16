/**
 * Configuration resources from the catalogue that the original project did not cover.
 *
 * Each gets list and get tools, plus upsert and delete unless the API is read
 * only. Tool names are the API resource name in lower case, for example
 * halo_fieldgroup_list for /FieldGroup.
 */

import { ResourceConfig } from "../resource-factory.js";
import { MergeRules } from "../../safety/merge.js";
import { CONFIG_RESOURCES, ConfigResource } from "../../catalogue/config-resources.js";

/** Nested arrays and their match keys, for the safe merge. */
export const CATALOGUE_MERGE_RULES: Record<string, MergeRules> = {
  FieldGroup: { fields: ["fieldid", "id"], tickettypes: ["id", "tickettype_id"] },
  Tabs: { fields: ["fieldid", "id"], tickettypes: ["id", "tickettype_id"] },
  Outcome: { fields: ["fieldid", "id"], workflows: ["id"], tickettypes: ["id"] },
  FieldInfo: { values: ["id", "value"], tickettypes: ["id"], fieldgroups: ["id"] },
  ApprovalProcess: { steps: ["id"], rules: ["id"] },
  DashboardLinks: { widgets: ["id", "guid"], access_control: ["agent_id", "team_id", "id"] },
  AssetTypeInfo: { fields: ["fieldid", "id"] },
};

/** Words in resource names, for readable descriptions. */
function describe(resource: string): string {
  const special: Record<string, string> = {
    CAB: "change advisory board",
    CABRole: "change advisory board role",
    CSVTemplate: "CSV template",
    FAQLists: "FAQ list",
    PdfTemplate: "PDF template",
    KBArticle: "knowledge base article",
    SLA: "SLA",
  };
  if (special[resource]) return special[resource];
  return resource
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
}

export function catalogueConfig(res: ConfigResource): ResourceConfig {
  return {
    name: res.resource.toLowerCase(),
    apiPath: `/${res.resource}`,
    description: describe(res.resource),
    readPermission: "Agent",
    writePermission: "Admin",
    mergeRules: CATALOGUE_MERGE_RULES[res.resource],
    disableOps: res.readOnly ? ["upsert", "delete"] : undefined,
  };
}

/** Catalogue resources whose API path is not already served by an existing config. */
export function catalogueConfigs(existingApiPaths: Set<string>): ResourceConfig[] {
  return CONFIG_RESOURCES.filter((r) => !existingApiPaths.has(`/${r.resource}`.toLowerCase())).map(catalogueConfig);
}
