# Coverage matrix

Configuration resources assessed: 96. In the original repo: 30. Missing from the original repo: 66.

> **Live columns pending.** This version was generated without access to the trial instance.
> Run `npx tsx scripts/coverage-matrix.ts --live` with the trial credentials set to fill in the
> List, Get, Create or update, Delete and Records columns and the field name appendix.

Known findings from the first assessment (version 2.250.x trial): 83 resources writable, 13 read only.
Field names only are recorded here; no record values.

Every resource below has list and get tools; writable resources also have upsert (with dry run) and, when enabled, delete.
Higher level tools: `halo_ticket_type_layout_get` / `_set`, `halo_field_group_get` / `_set`, `halo_reports_run`,
`halo_reports_clone`, `halo_report_groups_list` / `_create`, `halo_dashboard_build`, plus `halo_schema_get` and
`halo_config_probe` for diagnosis. Areas marked "needs a closer look" can be checked with `halo_config_probe`
(shape only, no values) and listed with extra query parameters through `extra_params`.

## Tickets and layout

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| TicketType | Configuration > Tickets > Ticket Types | `/api/TicketType` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_tickettypes_*`; Layout in fields[] (fieldid, groupid, seq, visibility flags); user panel in userfields[] |
| TicketTypeField | Configuration > Tickets > Ticket Types > Fields | `/api/TicketTypeField` | pending | pending | No (read only) | pending | pending | pending | No | Tools: `halo_tickettypefield_*`; Flat read only view of TicketType.fields |
| TicketTypeGroup | Configuration > Tickets > Ticket Type Groups (to confirm) | `/api/TicketTypeGroup` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_tickettypegroup_*` |
| Field | Configuration > Custom Objects > Custom Fields (to confirm) | `/api/Field` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_fields_*`; Detail call shape still to check |
| FieldInfo | Configuration > Custom Objects > Custom Fields | `/api/FieldInfo` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_fieldinfo_*`; Field definitions including system fields; lookup values, tickettypes, fieldgroups |
| FieldGroup | Configuration > Custom Objects > Field Groups | `/api/FieldGroup` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_fieldgroup_*`; fields[] with seq and group visibility conditions; tickettypes shows where used |
| HaloField | Configuration > Tickets > Fields (to confirm) | `/api/HaloField` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_halofield_*` |
| ScreenLayout | Configuration > Tickets > Screen Layouts (to confirm) | `/api/ScreenLayout` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_screenlayout_*`; tab_config, details_screen_layout |
| Tabs | Configuration > Custom Objects > Custom Tabs | `/api/Tabs` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_tabs_*`; Custom tabs with fields and tickettypes |
| SetupTab | Configuration (setup navigation) (to confirm) | `/api/SetupTab` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_setuptab_*` |
| SetupTabGroup | Configuration (setup navigation groups) (to confirm) | `/api/SetupTabGroup` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_setuptabgroup_*` |
| Status | Configuration > Tickets > Status | `/api/Status` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_status_*` |
| Priority | Configuration > Service Level Agreements > Priorities (to confirm) | `/api/Priority` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_priorities_*` |
| Category | Configuration > Tickets > Categories | `/api/Category` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_categories_*` |
| Template | Configuration > Tickets > Templates | `/api/Template` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_template_*` |
| Outcome | Configuration > Tickets > Actions | `/api/Outcome` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_outcome_*`; Ticket actions: fields on the action form, workflows, ticket types |
| CannedText | Configuration > Tickets > Canned Text | `/api/CannedText` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_cannedtext_*` |
| TicketArea | Configuration > Tickets > Ticket Areas (to confirm) | `/api/TicketArea` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_ticketarea_*` |
| ViewColumns | Configuration > Tickets > Views > Column Profiles (to confirm) | `/api/ViewColumns` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_viewcolumns_*` |
| ViewFilter | Configuration > Tickets > Views > Filter Profiles (to confirm) | `/api/ViewFilter` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_viewfilter_*` |
| ViewLists | Configuration > Tickets > Views > Ticket Views (to confirm) | `/api/ViewLists` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_viewlists_*` |
| ViewListGroup | Configuration > Tickets > Views > View Groups (to confirm) | `/api/ViewListGroup` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_viewlistgroup_*` |
| CustomButton | Configuration > Custom Objects > Custom Buttons (to confirm) | `/api/CustomButton` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_custombutton_*` |
| Lookup | Configuration > Custom Objects > Lookup Codes (to confirm) | `/api/Lookup` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_lookup_*`; Report groups are lookup 41 |
| ConfirmClosure | Configuration > Tickets > General Settings (to confirm) | `/api/ConfirmClosure` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_confirmclosure_*` |

## Workflow and automation

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Workflow | Configuration > Tickets > Workflows | `/api/Workflow` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_workflows_*`; steps[] (rules, actions, allowed statuses, start and end flags) and stages[] |
| WorkflowStep | Configuration > Tickets > Workflows > Steps | `/api/WorkflowStep` | pending | pending | No (read only) | pending | pending | pending | No | Tools: `halo_workflowstep_*` |
| WorkflowTarget | Configuration > Tickets > Workflows > Targets (to confirm) | `/api/WorkflowTarget` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_workflowtarget_*` |
| ApprovalProcess | Configuration > Tickets > Approval Processes | `/api/ApprovalProcess` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_approvalprocess_*` |
| ApprovalProcessRule | Configuration > Tickets > Approval Processes > Rules (to confirm) | `/api/ApprovalProcessRule` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_approvalprocessrule_*` |
| CAB | Configuration > Change Management > CABs (to confirm) | `/api/CAB` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_cab_*` |
| CABRole | Configuration > Change Management > CAB Roles (to confirm) | `/api/CABRole` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_cabrole_*` |
| TicketRules | Configuration > Tickets > Rules | `/api/TicketRules` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_ticketrules_*` |
| Automation | Configuration > Automations (to confirm) | `/api/Automation` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_automation_*`; Needs a closer look: unexpected list shape |
| EmailRule | Configuration > Email > Email Rules | `/api/EmailRule` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_emailrule_*` |
| Mailbox | Configuration > Email > Mailboxes | `/api/Mailbox` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_mailbox_*` |
| EmailTemplate | Configuration > Email > Email Templates | `/api/EmailTemplate` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_emailtemplate_*` |
| Notification | Configuration > Notifications (to confirm) | `/api/Notification` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_notification_*` |
| Webhook | Configuration > Integrations > Webhooks | `/api/Webhook` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_webhook_*` |
| EventRule | Configuration > Integrations > Event Rules (to confirm) | `/api/EventRule` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_eventrule_*` |
| TaskSchedule | Configuration > Tickets > Scheduled Tickets (to confirm) | `/api/TaskSchedule` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_taskschedule_*`; Needs a closer look: unexpected list shape |
| PowerShellScript | Configuration > Integrations > Scripts (to confirm) | `/api/PowerShellScript` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_powershellscript_*` |
| CustomIntegration | Configuration > Integrations > Custom Integrations | `/api/CustomIntegration` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_customintegration_*` |

## Service levels

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| SLA | Configuration > Service Level Agreements | `/api/SLA` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_sla_*` |
| Workday | Configuration > Service Level Agreements > Workdays | `/api/Workday` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_workdays_*` |
| Holiday | Configuration > Service Level Agreements > Workdays > Holidays (to confirm) | `/api/Holiday` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_holidays_*` |

## People and structure

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Agent | Configuration > Teams and Agents > Agents | `/api/Agent` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_agents_*` |
| Team | Configuration > Teams and Agents > Teams | `/api/Team` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_teams_*` |
| Roles | Configuration > Teams and Agents > Roles | `/api/Roles` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_roles_*` |
| UserRoles | Configuration > Users > User Roles (to confirm) | `/api/UserRoles` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_userroles_*` |
| Users | Users | `/api/Users` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_users_*` |
| Client | Customers | `/api/Client` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_clients_*` |
| Site | Customers > Sites | `/api/Site` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_sites_*` |
| Organisation | Configuration > Organisation (to confirm) | `/api/Organisation` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_organisations_*` |
| TopLevel | Configuration > Customers > Top Levels (to confirm) | `/api/TopLevel` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_toplevel_*` |
| DistributionLists | Configuration > Email > Distribution Lists (to confirm) | `/api/DistributionLists` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_distributionlists_*`; Needs a closer look: unexpected list shape |
| ContactGroup | Configuration > Users > Contact Groups (to confirm) | `/api/ContactGroup` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_contactgroup_*` |
| Qualification | Configuration > Teams and Agents > Qualifications (to confirm) | `/api/Qualification` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_qualification_*` |

## Service catalogue and portal

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Service | Service Catalogue (to confirm) | `/api/Service` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_services_*` |
| ServiceCategory | Configuration > Services > Service Categories (to confirm) | `/api/ServiceCategory` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_servicecategory_*` |
| ServiceStatus | Configuration > Services > Service Statuses (to confirm) | `/api/ServiceStatus` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_servicestatus_*` |
| ServiceRestriction | Configuration > Services > Restrictions (to confirm) | `/api/ServiceRestriction` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_servicerestriction_*` |
| Downtime | Service Catalogue > Scheduled Downtime (to confirm) | `/api/Downtime` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_downtime_*`; Needs a closer look: list failed or had an unexpected shape |
| KBArticle | Knowledge Base | `/api/KBArticle` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_kb_*` |
| FAQLists | Configuration > Knowledge Base > FAQ Lists (to confirm) | `/api/FAQLists` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_faqlists_*` |
| StyleProfile | Configuration > Self Service Portal > Style Profiles (to confirm) | `/api/StyleProfile` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_styleprofile_*` |
| Translation | Configuration > Language > Translations (to confirm) | `/api/Translation` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_translation_*` |

## Assets and CMDB

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| AssetType | Configuration > Asset Management > Asset Types | `/api/AssetType` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_assettypes_*`; fields and tab_config |
| AssetTypeInfo | Configuration > Asset Management > Asset Types (fields) (to confirm) | `/api/AssetTypeInfo` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_assettypeinfo_*` |
| AssetGroup | Configuration > Asset Management > Asset Groups | `/api/AssetGroup` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_assetgroups_*` |
| SoftwareLicence | Assets > Software Licences (to confirm) | `/api/SoftwareLicence` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_softwarelicences_*`; Needs a closer look: unexpected list shape |

## Reporting

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Report | Reporting > Reports | `/api/Report` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_reports_*`; Run with loadreport=true; chart settings charttype, xaxis, yaxis and others |
| ReportRepository | Reporting > Report Repository (to confirm) | `/api/ReportRepository` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_reportrepository_*` |
| DashboardLinks | Reporting > Dashboards | `/api/DashboardLinks` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_dashboardlinks_*`; Widgets; layouts is a JSON string keyed by breakpoint (lg = 12 columns) |
| DashboardLinksRepository | Reporting > Dashboards > Repository (to confirm) | `/api/DashboardLinksRepository` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_dashboardlinksrepository_*` |
| PdfTemplate | Configuration > Templates > PDF Templates (to confirm) | `/api/PdfTemplate` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_pdftemplate_*` |
| PublishProfiles | Reporting > Publish Profiles (to confirm) | `/api/PublishProfiles` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_publishprofiles_*` |
| CSVTemplate | Configuration > Data Import > CSV Templates (to confirm) | `/api/CSVTemplate` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_csvtemplate_*` |
| CustomTable | Configuration > Custom Objects > Custom Tables (to confirm) | `/api/CustomTable` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_customtable_*` |
| CustomQuery | Configuration > Custom Objects > Custom Queries (to confirm) | `/api/CustomQuery` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_customquery_*` |

## Other configuration

| Resource | UI path | Endpoint | List | Get | Create or update | Delete | Records on trial | Nested child objects | In original repo | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Tags | Configuration > General Settings > Tags (to confirm) | `/api/Tags` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_tags_*` |
| Features | Configuration > Modules (to confirm) | `/api/Features` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_features_*` |
| Tenant | Configuration > Tenants (to confirm) | `/api/Tenant` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_tenant_*`; Needs a closer look: unexpected list shape |
| Languages | Configuration > Language (to confirm) | `/api/Languages` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_languages_*` |
| Currency | Configuration > Financials > Currencies (to confirm) | `/api/Currency` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_currency_*` |
| Tax | Configuration > Financials > Tax Rules (to confirm) | `/api/Tax` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_tax_*` |
| ChargeRate | Configuration > Financials > Charge Rates (to confirm) | `/api/ChargeRate` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_chargerate_*` |
| CostCentres | Configuration > Financials > Cost Centres (to confirm) | `/api/CostCentres` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_costcentres_*` |
| BookingType | Configuration > Calendars > Appointment Types (to confirm) | `/api/BookingType` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_bookingtype_*` |
| Supplier | Suppliers | `/api/Supplier` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_suppliers_*` |
| SupplierContract | Suppliers > Contracts (to confirm) | `/api/SupplierContract` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_suppliercontract_*` |
| ClientContract | Customers > Contracts (to confirm) | `/api/ClientContract` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_contracts_*`; Needs a closer look: unexpected list shape |
| Item | Items | `/api/Item` | pending | pending | pending | pending | pending | pending | Yes | Tools: `halo_items_*` |
| ResourceType | Configuration > Calendars > Resource Types (to confirm) | `/api/ResourceType` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_resourcetype_*` |
| ReleaseType | Configuration > Release Management > Release Types (to confirm) | `/api/ReleaseType` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_releasetype_*` |
| PipelineStages | Configuration > Release Management > Pipeline Stages (to confirm) | `/api/PipelineStages` | pending | pending | pending | pending | pending | pending | No | Tools: `halo_pipelinestages_*` |

## Appendix: field names per resource

Pending a live run.
