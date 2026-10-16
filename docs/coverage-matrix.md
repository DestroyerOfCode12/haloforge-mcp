# Coverage matrix

Configuration resources assessed: 96. In the original repo: 30. Missing from the original repo: 66.

> **Live columns pending.** This version was generated without access to the trial instance.
> Run `npx tsx scripts/coverage-matrix.ts --live` with the trial credentials set to fill in the
> List, Get, Create or update, Delete and Records columns and the field name appendix.

Known findings from the first assessment (version 2.250.x trial): 83 resources writable, 13 read only.
Field names only are recorded here; no record values.

## Tickets and layout

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| TicketType | Configuration > Tickets > Ticket Types | `/api/TicketType` | pending | pending | pending | pending | pending | pending | Yes | Layout in fields[] (fieldid, groupid, seq, visibility flags); user panel in userfields[] |
| TicketTypeField | Configuration > Tickets > Ticket Types > Fields | `/api/TicketTypeField` | pending | pending | No (read only) | pending | pending | pending | No | Flat read only view of TicketType.fields |
| TicketTypeGroup | Configuration > Tickets > Ticket Type Groups (to confirm) | `/api/TicketTypeGroup` | pending | pending | pending | pending | pending | pending | No |  |
| Field | Configuration > Custom Objects > Custom Fields (to confirm) | `/api/Field` | pending | pending | pending | pending | pending | pending | Yes | Detail call shape still to check |
| FieldInfo | Configuration > Custom Objects > Custom Fields | `/api/FieldInfo` | pending | pending | pending | pending | pending | pending | No | Field definitions including system fields; lookup values, tickettypes, fieldgroups |
| FieldGroup | Configuration > Custom Objects > Field Groups | `/api/FieldGroup` | pending | pending | pending | pending | pending | pending | No | fields[] with seq and group visibility conditions; tickettypes shows where used |
| HaloField | Configuration > Tickets > Fields (to confirm) | `/api/HaloField` | pending | pending | pending | pending | pending | pending | No |  |
| ScreenLayout | Configuration > Tickets > Screen Layouts (to confirm) | `/api/ScreenLayout` | pending | pending | pending | pending | pending | pending | No | tab_config, details_screen_layout |
| Tabs | Configuration > Custom Objects > Custom Tabs | `/api/Tabs` | pending | pending | pending | pending | pending | pending | No | Custom tabs with fields and tickettypes |
| SetupTab | Configuration (setup navigation) (to confirm) | `/api/SetupTab` | pending | pending | pending | pending | pending | pending | No |  |
| SetupTabGroup | Configuration (setup navigation groups) (to confirm) | `/api/SetupTabGroup` | pending | pending | pending | pending | pending | pending | No |  |
| Status | Configuration > Tickets > Status | `/api/Status` | pending | pending | pending | pending | pending | pending | Yes |  |
| Priority | Configuration > Service Level Agreements > Priorities (to confirm) | `/api/Priority` | pending | pending | pending | pending | pending | pending | Yes |  |
| Category | Configuration > Tickets > Categories | `/api/Category` | pending | pending | pending | pending | pending | pending | Yes |  |
| Template | Configuration > Tickets > Templates | `/api/Template` | pending | pending | pending | pending | pending | pending | No |  |
| Outcome | Configuration > Tickets > Actions | `/api/Outcome` | pending | pending | pending | pending | pending | pending | No | Ticket actions: fields on the action form, workflows, ticket types |
| CannedText | Configuration > Tickets > Canned Text | `/api/CannedText` | pending | pending | pending | pending | pending | pending | Yes |  |
| TicketArea | Configuration > Tickets > Ticket Areas (to confirm) | `/api/TicketArea` | pending | pending | pending | pending | pending | pending | No |  |
| ViewColumns | Configuration > Tickets > Views > Column Profiles (to confirm) | `/api/ViewColumns` | pending | pending | pending | pending | pending | pending | No |  |
| ViewFilter | Configuration > Tickets > Views > Filter Profiles (to confirm) | `/api/ViewFilter` | pending | pending | pending | pending | pending | pending | No |  |
| ViewLists | Configuration > Tickets > Views > Ticket Views (to confirm) | `/api/ViewLists` | pending | pending | pending | pending | pending | pending | No |  |
| ViewListGroup | Configuration > Tickets > Views > View Groups (to confirm) | `/api/ViewListGroup` | pending | pending | pending | pending | pending | pending | No |  |
| CustomButton | Configuration > Custom Objects > Custom Buttons (to confirm) | `/api/CustomButton` | pending | pending | pending | pending | pending | pending | No |  |
| Lookup | Configuration > Custom Objects > Lookup Codes (to confirm) | `/api/Lookup` | pending | pending | pending | pending | pending | pending | No | Report groups are lookup 41 |
| ConfirmClosure | Configuration > Tickets > General Settings (to confirm) | `/api/ConfirmClosure` | pending | pending | pending | pending | pending | pending | No |  |

## Workflow and automation

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Workflow | Configuration > Tickets > Workflows | `/api/Workflow` | pending | pending | pending | pending | pending | pending | Yes | steps[] (rules, actions, allowed statuses, start and end flags) and stages[] |
| WorkflowStep | Configuration > Tickets > Workflows > Steps | `/api/WorkflowStep` | pending | pending | No (read only) | pending | pending | pending | No |  |
| WorkflowTarget | Configuration > Tickets > Workflows > Targets (to confirm) | `/api/WorkflowTarget` | pending | pending | pending | pending | pending | pending | No |  |
| ApprovalProcess | Configuration > Tickets > Approval Processes | `/api/ApprovalProcess` | pending | pending | pending | pending | pending | pending | No |  |
| ApprovalProcessRule | Configuration > Tickets > Approval Processes > Rules (to confirm) | `/api/ApprovalProcessRule` | pending | pending | pending | pending | pending | pending | No |  |
| CAB | Configuration > Change Management > CABs (to confirm) | `/api/CAB` | pending | pending | pending | pending | pending | pending | No |  |
| CABRole | Configuration > Change Management > CAB Roles (to confirm) | `/api/CABRole` | pending | pending | pending | pending | pending | pending | No |  |
| TicketRules | Configuration > Tickets > Rules | `/api/TicketRules` | pending | pending | pending | pending | pending | pending | Yes |  |
| Automation | Configuration > Automations (to confirm) | `/api/Automation` | pending | pending | pending | pending | pending | pending | No | Needs a closer look: unexpected list shape |
| EmailRule | Configuration > Email > Email Rules | `/api/EmailRule` | pending | pending | pending | pending | pending | pending | No |  |
| Mailbox | Configuration > Email > Mailboxes | `/api/Mailbox` | pending | pending | pending | pending | pending | pending | No |  |
| EmailTemplate | Configuration > Email > Email Templates | `/api/EmailTemplate` | pending | pending | pending | pending | pending | pending | No |  |
| Notification | Configuration > Notifications (to confirm) | `/api/Notification` | pending | pending | pending | pending | pending | pending | No |  |
| Webhook | Configuration > Integrations > Webhooks | `/api/Webhook` | pending | pending | pending | pending | pending | pending | No |  |
| EventRule | Configuration > Integrations > Event Rules (to confirm) | `/api/EventRule` | pending | pending | pending | pending | pending | pending | No |  |
| TaskSchedule | Configuration > Tickets > Scheduled Tickets (to confirm) | `/api/TaskSchedule` | pending | pending | pending | pending | pending | pending | No | Needs a closer look: unexpected list shape |
| PowerShellScript | Configuration > Integrations > Scripts (to confirm) | `/api/PowerShellScript` | pending | pending | pending | pending | pending | pending | No |  |
| CustomIntegration | Configuration > Integrations > Custom Integrations | `/api/CustomIntegration` | pending | pending | pending | pending | pending | pending | No |  |

## Service levels

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| SLA | Configuration > Service Level Agreements | `/api/SLA` | pending | pending | pending | pending | pending | pending | Yes |  |
| Workday | Configuration > Service Level Agreements > Workdays | `/api/Workday` | pending | pending | pending | pending | pending | pending | Yes |  |
| Holiday | Configuration > Service Level Agreements > Workdays > Holidays (to confirm) | `/api/Holiday` | pending | pending | pending | pending | pending | pending | Yes |  |

## People and structure

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Agent | Configuration > Teams and Agents > Agents | `/api/Agent` | pending | pending | pending | pending | pending | pending | Yes |  |
| Team | Configuration > Teams and Agents > Teams | `/api/Team` | pending | pending | pending | pending | pending | pending | Yes |  |
| Roles | Configuration > Teams and Agents > Roles | `/api/Roles` | pending | pending | pending | pending | pending | pending | No |  |
| UserRoles | Configuration > Users > User Roles (to confirm) | `/api/UserRoles` | pending | pending | pending | pending | pending | pending | No |  |
| Users | Users | `/api/Users` | pending | pending | pending | pending | pending | pending | Yes |  |
| Client | Customers | `/api/Client` | pending | pending | pending | pending | pending | pending | Yes |  |
| Site | Customers > Sites | `/api/Site` | pending | pending | pending | pending | pending | pending | Yes |  |
| Organisation | Configuration > Organisation (to confirm) | `/api/Organisation` | pending | pending | pending | pending | pending | pending | Yes |  |
| TopLevel | Configuration > Customers > Top Levels (to confirm) | `/api/TopLevel` | pending | pending | pending | pending | pending | pending | Yes |  |
| DistributionLists | Configuration > Email > Distribution Lists (to confirm) | `/api/DistributionLists` | pending | pending | pending | pending | pending | pending | No | Needs a closer look: unexpected list shape |
| ContactGroup | Configuration > Users > Contact Groups (to confirm) | `/api/ContactGroup` | pending | pending | pending | pending | pending | pending | No |  |
| Qualification | Configuration > Teams and Agents > Qualifications (to confirm) | `/api/Qualification` | pending | pending | pending | pending | pending | pending | No |  |

## Service catalogue and portal

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Service | Service Catalogue (to confirm) | `/api/Service` | pending | pending | pending | pending | pending | pending | Yes |  |
| ServiceCategory | Configuration > Services > Service Categories (to confirm) | `/api/ServiceCategory` | pending | pending | pending | pending | pending | pending | No |  |
| ServiceStatus | Configuration > Services > Service Statuses (to confirm) | `/api/ServiceStatus` | pending | pending | pending | pending | pending | pending | Yes |  |
| ServiceRestriction | Configuration > Services > Restrictions (to confirm) | `/api/ServiceRestriction` | pending | pending | pending | pending | pending | pending | No |  |
| Downtime | Service Catalogue > Scheduled Downtime (to confirm) | `/api/Downtime` | pending | pending | pending | pending | pending | pending | Yes | Needs a closer look: list failed or had an unexpected shape |
| KBArticle | Knowledge Base | `/api/KBArticle` | pending | pending | pending | pending | pending | pending | Yes |  |
| FAQLists | Configuration > Knowledge Base > FAQ Lists (to confirm) | `/api/FAQLists` | pending | pending | pending | pending | pending | pending | No |  |
| StyleProfile | Configuration > Self Service Portal > Style Profiles (to confirm) | `/api/StyleProfile` | pending | pending | pending | pending | pending | pending | No |  |
| Translation | Configuration > Language > Translations (to confirm) | `/api/Translation` | pending | pending | pending | pending | pending | pending | No |  |

## Assets and CMDB

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| AssetType | Configuration > Asset Management > Asset Types | `/api/AssetType` | pending | pending | pending | pending | pending | pending | Yes | fields and tab_config |
| AssetTypeInfo | Configuration > Asset Management > Asset Types (fields) (to confirm) | `/api/AssetTypeInfo` | pending | pending | pending | pending | pending | pending | No |  |
| AssetGroup | Configuration > Asset Management > Asset Groups | `/api/AssetGroup` | pending | pending | pending | pending | pending | pending | Yes |  |
| SoftwareLicence | Assets > Software Licences (to confirm) | `/api/SoftwareLicence` | pending | pending | pending | pending | pending | pending | Yes | Needs a closer look: unexpected list shape |

## Reporting

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Report | Reporting > Reports | `/api/Report` | pending | pending | pending | pending | pending | pending | Yes | Run with loadreport=true; chart settings charttype, xaxis, yaxis and others |
| ReportRepository | Reporting > Report Repository (to confirm) | `/api/ReportRepository` | pending | pending | pending | pending | pending | pending | No |  |
| DashboardLinks | Reporting > Dashboards | `/api/DashboardLinks` | pending | pending | pending | pending | pending | pending | No | Widgets; layouts is a JSON string keyed by breakpoint (lg = 12 columns) |
| DashboardLinksRepository | Reporting > Dashboards > Repository (to confirm) | `/api/DashboardLinksRepository` | pending | pending | pending | pending | pending | pending | No |  |
| PdfTemplate | Configuration > Templates > PDF Templates (to confirm) | `/api/PdfTemplate` | pending | pending | pending | pending | pending | pending | No |  |
| PublishProfiles | Reporting > Publish Profiles (to confirm) | `/api/PublishProfiles` | pending | pending | pending | pending | pending | pending | No |  |
| CSVTemplate | Configuration > Data Import > CSV Templates (to confirm) | `/api/CSVTemplate` | pending | pending | pending | pending | pending | pending | No |  |
| CustomTable | Configuration > Custom Objects > Custom Tables (to confirm) | `/api/CustomTable` | pending | pending | pending | pending | pending | pending | No |  |
| CustomQuery | Configuration > Custom Objects > Custom Queries (to confirm) | `/api/CustomQuery` | pending | pending | pending | pending | pending | pending | No |  |

## Other configuration

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Tags | Configuration > General Settings > Tags (to confirm) | `/api/Tags` | pending | pending | pending | pending | pending | pending | Yes |  |
| Features | Configuration > Modules (to confirm) | `/api/Features` | pending | pending | pending | pending | pending | pending | No |  |
| Tenant | Configuration > Tenants (to confirm) | `/api/Tenant` | pending | pending | pending | pending | pending | pending | No | Needs a closer look: unexpected list shape |
| Languages | Configuration > Language (to confirm) | `/api/Languages` | pending | pending | pending | pending | pending | pending | No |  |
| Currency | Configuration > Financials > Currencies (to confirm) | `/api/Currency` | pending | pending | pending | pending | pending | pending | No |  |
| Tax | Configuration > Financials > Tax Rules (to confirm) | `/api/Tax` | pending | pending | pending | pending | pending | pending | No |  |
| ChargeRate | Configuration > Financials > Charge Rates (to confirm) | `/api/ChargeRate` | pending | pending | pending | pending | pending | pending | No |  |
| CostCentres | Configuration > Financials > Cost Centres (to confirm) | `/api/CostCentres` | pending | pending | pending | pending | pending | pending | No |  |
| BookingType | Configuration > Calendars > Appointment Types (to confirm) | `/api/BookingType` | pending | pending | pending | pending | pending | pending | No |  |
| Supplier | Suppliers | `/api/Supplier` | pending | pending | pending | pending | pending | pending | Yes |  |
| SupplierContract | Suppliers > Contracts (to confirm) | `/api/SupplierContract` | pending | pending | pending | pending | pending | pending | No |  |
| ClientContract | Customers > Contracts (to confirm) | `/api/ClientContract` | pending | pending | pending | pending | pending | pending | Yes | Needs a closer look: unexpected list shape |
| Item | Items | `/api/Item` | pending | pending | pending | pending | pending | pending | Yes |  |
| ResourceType | Configuration > Calendars > Resource Types (to confirm) | `/api/ResourceType` | pending | pending | pending | pending | pending | pending | No |  |
| ReleaseType | Configuration > Release Management > Release Types (to confirm) | `/api/ReleaseType` | pending | pending | pending | pending | pending | pending | No |  |
| PipelineStages | Configuration > Release Management > Pipeline Stages (to confirm) | `/api/PipelineStages` | pending | pending | pending | pending | pending | pending | No |  |

## Appendix: field names per resource

Pending a live run.
