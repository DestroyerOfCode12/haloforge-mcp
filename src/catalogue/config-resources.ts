/**
 * HaloForge MCP | Configuration resource catalogue
 *
 * The 96 configuration resources assessed in the coverage matrix, grouped by
 * area. Used by the coverage matrix generator and by the export, compare and
 * copy tools to decide what belongs to an area.
 *
 * UI paths marked "(to confirm)" have not yet been checked against the trial.
 */

export type ConfigArea =
  | "Tickets and layout"
  | "Workflow and automation"
  | "Service levels"
  | "People and structure"
  | "Service catalogue and portal"
  | "Assets and CMDB"
  | "Reporting"
  | "Other configuration";

export interface ConfigResource {
  /** Halo API resource name, as used in /api/{resource} */
  resource: string;
  area: ConfigArea;
  /** Path in the Halo agent UI */
  uiPath: string;
  /** Known to be read only through the API */
  readOnly?: boolean;
  notes?: string;
}

export const CONFIG_AREAS: ConfigArea[] = [
  "Tickets and layout",
  "Workflow and automation",
  "Service levels",
  "People and structure",
  "Service catalogue and portal",
  "Assets and CMDB",
  "Reporting",
  "Other configuration",
];

const T: ConfigArea = "Tickets and layout";
const W: ConfigArea = "Workflow and automation";
const S: ConfigArea = "Service levels";
const P: ConfigArea = "People and structure";
const C: ConfigArea = "Service catalogue and portal";
const A: ConfigArea = "Assets and CMDB";
const R: ConfigArea = "Reporting";
const O: ConfigArea = "Other configuration";

export const CONFIG_RESOURCES: ConfigResource[] = [
  // Tickets and layout
  { resource: "TicketType", area: T, uiPath: "Configuration > Tickets > Ticket Types", notes: "Layout in fields[] (fieldid, groupid, seq, visibility flags); user panel in userfields[]" },
  { resource: "TicketTypeField", area: T, uiPath: "Configuration > Tickets > Ticket Types > Fields", readOnly: true, notes: "Flat read only view of TicketType.fields" },
  { resource: "TicketTypeGroup", area: T, uiPath: "Configuration > Tickets > Ticket Type Groups (to confirm)" },
  { resource: "Field", area: T, uiPath: "Configuration > Custom Objects > Custom Fields (to confirm)", notes: "Detail call shape still to check" },
  { resource: "FieldInfo", area: T, uiPath: "Configuration > Custom Objects > Custom Fields", notes: "Field definitions including system fields; lookup values, tickettypes, fieldgroups" },
  { resource: "FieldGroup", area: T, uiPath: "Configuration > Custom Objects > Field Groups", notes: "fields[] with seq and group visibility conditions; tickettypes shows where used" },
  { resource: "HaloField", area: T, uiPath: "Configuration > Tickets > Fields (to confirm)" },
  { resource: "ScreenLayout", area: T, uiPath: "Configuration > Tickets > Screen Layouts (to confirm)", notes: "tab_config, details_screen_layout" },
  { resource: "Tabs", area: T, uiPath: "Configuration > Custom Objects > Custom Tabs", notes: "Custom tabs with fields and tickettypes" },
  { resource: "SetupTab", area: T, uiPath: "Configuration (setup navigation) (to confirm)" },
  { resource: "SetupTabGroup", area: T, uiPath: "Configuration (setup navigation groups) (to confirm)" },
  { resource: "Status", area: T, uiPath: "Configuration > Tickets > Status" },
  { resource: "Priority", area: T, uiPath: "Configuration > Service Level Agreements > Priorities (to confirm)" },
  { resource: "Category", area: T, uiPath: "Configuration > Tickets > Categories" },
  { resource: "Template", area: T, uiPath: "Configuration > Tickets > Templates" },
  { resource: "Outcome", area: T, uiPath: "Configuration > Tickets > Actions", notes: "Ticket actions: fields on the action form, workflows, ticket types" },
  { resource: "CannedText", area: T, uiPath: "Configuration > Tickets > Canned Text" },
  { resource: "TicketArea", area: T, uiPath: "Configuration > Tickets > Ticket Areas (to confirm)" },
  { resource: "ViewColumns", area: T, uiPath: "Configuration > Tickets > Views > Column Profiles (to confirm)" },
  { resource: "ViewFilter", area: T, uiPath: "Configuration > Tickets > Views > Filter Profiles (to confirm)" },
  { resource: "ViewLists", area: T, uiPath: "Configuration > Tickets > Views > Ticket Views (to confirm)" },
  { resource: "ViewListGroup", area: T, uiPath: "Configuration > Tickets > Views > View Groups (to confirm)" },
  { resource: "CustomButton", area: T, uiPath: "Configuration > Custom Objects > Custom Buttons (to confirm)" },
  { resource: "Lookup", area: T, uiPath: "Configuration > Custom Objects > Lookup Codes (to confirm)", notes: "Report groups are lookup 41" },
  { resource: "ConfirmClosure", area: T, uiPath: "Configuration > Tickets > General Settings (to confirm)" },

  // Workflow and automation
  { resource: "Workflow", area: W, uiPath: "Configuration > Tickets > Workflows", notes: "steps[] (rules, actions, allowed statuses, start and end flags) and stages[]" },
  { resource: "WorkflowStep", area: W, uiPath: "Configuration > Tickets > Workflows > Steps", readOnly: true },
  { resource: "WorkflowTarget", area: W, uiPath: "Configuration > Tickets > Workflows > Targets (to confirm)" },
  { resource: "ApprovalProcess", area: W, uiPath: "Configuration > Tickets > Approval Processes" },
  { resource: "ApprovalProcessRule", area: W, uiPath: "Configuration > Tickets > Approval Processes > Rules (to confirm)" },
  { resource: "CAB", area: W, uiPath: "Configuration > Change Management > CABs (to confirm)" },
  { resource: "CABRole", area: W, uiPath: "Configuration > Change Management > CAB Roles (to confirm)" },
  { resource: "TicketRules", area: W, uiPath: "Configuration > Tickets > Rules" },
  { resource: "Automation", area: W, uiPath: "Configuration > Automations (to confirm)", notes: "Needs a closer look: unexpected list shape" },
  { resource: "EmailRule", area: W, uiPath: "Configuration > Email > Email Rules" },
  { resource: "Mailbox", area: W, uiPath: "Configuration > Email > Mailboxes" },
  { resource: "EmailTemplate", area: W, uiPath: "Configuration > Email > Email Templates" },
  { resource: "Notification", area: W, uiPath: "Configuration > Notifications (to confirm)" },
  { resource: "Webhook", area: W, uiPath: "Configuration > Integrations > Webhooks" },
  { resource: "EventRule", area: W, uiPath: "Configuration > Integrations > Event Rules (to confirm)" },
  { resource: "TaskSchedule", area: W, uiPath: "Configuration > Tickets > Scheduled Tickets (to confirm)", notes: "Needs a closer look: unexpected list shape" },
  { resource: "PowerShellScript", area: W, uiPath: "Configuration > Integrations > Scripts (to confirm)" },
  { resource: "CustomIntegration", area: W, uiPath: "Configuration > Integrations > Custom Integrations" },

  // Service levels
  { resource: "SLA", area: S, uiPath: "Configuration > Service Level Agreements" },
  { resource: "Workday", area: S, uiPath: "Configuration > Service Level Agreements > Workdays" },
  { resource: "Holiday", area: S, uiPath: "Configuration > Service Level Agreements > Workdays > Holidays (to confirm)" },

  // People and structure
  { resource: "Agent", area: P, uiPath: "Configuration > Teams and Agents > Agents" },
  { resource: "Team", area: P, uiPath: "Configuration > Teams and Agents > Teams" },
  { resource: "Roles", area: P, uiPath: "Configuration > Teams and Agents > Roles" },
  { resource: "UserRoles", area: P, uiPath: "Configuration > Users > User Roles (to confirm)" },
  { resource: "Users", area: P, uiPath: "Users" },
  { resource: "Client", area: P, uiPath: "Customers" },
  { resource: "Site", area: P, uiPath: "Customers > Sites" },
  { resource: "Organisation", area: P, uiPath: "Configuration > Organisation (to confirm)" },
  { resource: "TopLevel", area: P, uiPath: "Configuration > Customers > Top Levels (to confirm)" },
  { resource: "DistributionLists", area: P, uiPath: "Configuration > Email > Distribution Lists (to confirm)", notes: "Needs a closer look: unexpected list shape" },
  { resource: "ContactGroup", area: P, uiPath: "Configuration > Users > Contact Groups (to confirm)" },
  { resource: "Qualification", area: P, uiPath: "Configuration > Teams and Agents > Qualifications (to confirm)" },

  // Service catalogue and portal
  { resource: "Service", area: C, uiPath: "Service Catalogue (to confirm)" },
  { resource: "ServiceCategory", area: C, uiPath: "Configuration > Services > Service Categories (to confirm)" },
  { resource: "ServiceStatus", area: C, uiPath: "Configuration > Services > Service Statuses (to confirm)" },
  { resource: "ServiceRestriction", area: C, uiPath: "Configuration > Services > Restrictions (to confirm)" },
  { resource: "Downtime", area: C, uiPath: "Service Catalogue > Scheduled Downtime (to confirm)", notes: "Needs a closer look: list failed or had an unexpected shape" },
  { resource: "KBArticle", area: C, uiPath: "Knowledge Base" },
  { resource: "FAQLists", area: C, uiPath: "Configuration > Knowledge Base > FAQ Lists (to confirm)" },
  { resource: "StyleProfile", area: C, uiPath: "Configuration > Self Service Portal > Style Profiles (to confirm)" },
  { resource: "Translation", area: C, uiPath: "Configuration > Language > Translations (to confirm)" },

  // Assets and CMDB
  { resource: "AssetType", area: A, uiPath: "Configuration > Asset Management > Asset Types", notes: "fields and tab_config" },
  { resource: "AssetTypeInfo", area: A, uiPath: "Configuration > Asset Management > Asset Types (fields) (to confirm)" },
  { resource: "AssetGroup", area: A, uiPath: "Configuration > Asset Management > Asset Groups" },
  { resource: "SoftwareLicence", area: A, uiPath: "Assets > Software Licences (to confirm)", notes: "Needs a closer look: unexpected list shape" },

  // Reporting
  { resource: "Report", area: R, uiPath: "Reporting > Reports", notes: "Run with loadreport=true; chart settings charttype, xaxis, yaxis and others" },
  { resource: "ReportRepository", area: R, uiPath: "Reporting > Report Repository (to confirm)" },
  { resource: "DashboardLinks", area: R, uiPath: "Reporting > Dashboards", notes: "Widgets; layouts is a JSON string keyed by breakpoint (lg = 12 columns)" },
  { resource: "DashboardLinksRepository", area: R, uiPath: "Reporting > Dashboards > Repository (to confirm)" },
  { resource: "PdfTemplate", area: R, uiPath: "Configuration > Templates > PDF Templates (to confirm)" },
  { resource: "PublishProfiles", area: R, uiPath: "Reporting > Publish Profiles (to confirm)" },
  { resource: "CSVTemplate", area: R, uiPath: "Configuration > Data Import > CSV Templates (to confirm)" },
  { resource: "CustomTable", area: R, uiPath: "Configuration > Custom Objects > Custom Tables (to confirm)" },
  { resource: "CustomQuery", area: R, uiPath: "Configuration > Custom Objects > Custom Queries (to confirm)" },

  // Other configuration
  { resource: "Tags", area: O, uiPath: "Configuration > General Settings > Tags (to confirm)" },
  { resource: "Features", area: O, uiPath: "Configuration > Modules (to confirm)" },
  { resource: "Tenant", area: O, uiPath: "Configuration > Tenants (to confirm)", notes: "Needs a closer look: unexpected list shape" },
  { resource: "Languages", area: O, uiPath: "Configuration > Language (to confirm)" },
  { resource: "Currency", area: O, uiPath: "Configuration > Financials > Currencies (to confirm)" },
  { resource: "Tax", area: O, uiPath: "Configuration > Financials > Tax Rules (to confirm)" },
  { resource: "ChargeRate", area: O, uiPath: "Configuration > Financials > Charge Rates (to confirm)" },
  { resource: "CostCentres", area: O, uiPath: "Configuration > Financials > Cost Centres (to confirm)" },
  { resource: "BookingType", area: O, uiPath: "Configuration > Calendars > Appointment Types (to confirm)" },
  { resource: "Supplier", area: O, uiPath: "Suppliers" },
  { resource: "SupplierContract", area: O, uiPath: "Suppliers > Contracts (to confirm)" },
  { resource: "ClientContract", area: O, uiPath: "Customers > Contracts (to confirm)", notes: "Needs a closer look: unexpected list shape" },
  { resource: "Item", area: O, uiPath: "Items" },
  { resource: "ResourceType", area: O, uiPath: "Configuration > Calendars > Resource Types (to confirm)" },
  { resource: "ReleaseType", area: O, uiPath: "Configuration > Release Management > Release Types (to confirm)" },
  { resource: "PipelineStages", area: O, uiPath: "Configuration > Release Management > Pipeline Stages (to confirm)" },
];

/** API resources the original halo-itsm-mcp project already exposed. */
export const ORIGINAL_REPO_RESOURCES = new Set([
  "Actions", "Agent", "Appointment", "AssetGroup", "AssetType", "Asset", "Attachment", "Audit",
  "CannedText", "Category", "Client", "ClientContract", "Downtime", "Feedback", "Field", "Holiday",
  "Invoice", "Item", "KBArticle", "Opportunities", "Organisation", "Priority", "Projects",
  "PurchaseOrder", "Quotation", "Report", "ServiceStatus", "Service", "Site", "SLA",
  "SoftwareLicence", "Status", "Supplier", "Tags", "Team", "TicketRules", "TicketType", "Tickets",
  "Timesheet", "TopLevel", "Users", "Workday", "Workflow",
]);

export function resourcesInArea(area: ConfigArea): ConfigResource[] {
  return CONFIG_RESOURCES.filter((r) => r.area === area);
}

export function findConfigResource(name: string): ConfigResource | undefined {
  const lower = name.toLowerCase();
  return CONFIG_RESOURCES.find((r) => r.resource.toLowerCase() === lower);
}
