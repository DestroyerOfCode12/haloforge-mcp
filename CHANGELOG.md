# Changelog

## 2.0.0

### Phase 5: integration tests and documentation

* Integration suite behind `RUN_INTEGRATION=1`: reads every matrix area; creates and updates one `MCP TEST |` object per safe writable area and reads it back; ticket type layout round trip; report group, report and dashboard built, exported, compared and copied in dry run. Never deletes, refuses production like names, only updates test objects, reuses objects on reruns and writes `docs/test-objects.md`.
* Local fake Halo server (`npm run fake-halo`) to check the suite without an instance. The suite passes against it, including a rerun that reuses every object.
* `docs/tools.md` generated from the tool definitions (`npm run tools-doc`): every tool with its arguments, and examples.
* README: status, documentation links, development and integration test instructions.
* Not yet run against a live instance; `docs/test-objects.md` and the live columns of `docs/coverage-matrix.md` are pending that run.

### Phase 4: moving configuration between instances

* `halo_config_export`: chosen areas, resources or all configuration to JSON, one file per object plus a manifest, sensitive values masked, written only inside `HALO_EXPORT_DIR` (default `./exports`, git ignored).
* `halo_config_compare`: instance against instance or export against instance, matched by name, ignoring IDs, GUIDs, dates and sensitive values; lists missing, only in target and changed field paths.
* `halo_config_copy`: copies objects with references mapped by name (report groups, teams, agents, statuses, fields, field groups, ticket types, SLAs, priorities, workflows, reports in dashboard widgets). Pulls in dependencies, creates in dependency order and chains new IDs. Dry run by default with a full plan; applying is refused on read mode targets and while references are unresolved. Never copies sensitive values.
* `halo_config_document`: markdown configuration summary for handover documents, returned or written to a file.
* Catalogue marks record like resources so area exports skip them unless `include_data` is set.
* Diffs now match array items on `fieldid`, `field_id`, `guid` or `name` when no `id` fits.
* Not yet verified against a live instance; dashboard widget IDs and layout keys on copy follow the same assumptions as `halo_dashboard_build`.

### Phase 3: full configuration coverage

* List, get, upsert (dry run, safe merge) and delete tools for the 66 catalogue configuration resources the original did not cover; read only resources (TicketTypeField, WorkflowStep) get list and get only. Merge keys for FieldGroup, Tabs, Outcome, FieldInfo, ApprovalProcess, DashboardLinks and AssetTypeInfo nested arrays.
* `extra_params` on every list and get tool for any other Halo query parameter.
* Higher level tools: `halo_ticket_type_layout_get` / `_set`, `halo_field_group_get` / `_set`, `halo_reports_run`, `halo_reports_clone`, `halo_report_groups_list` / `_create`, `halo_dashboard_build`.
* Diagnostics: `halo_schema_get` (API spec lookup) and `halo_config_probe` (response shape without values) for the areas that needed a closer look.
* `HALO_TOOLS` and `HALO_TOOLS_EXCLUDE` to limit the registered tools.
* The merge helper now prefers a match key that both the change and the current items carry.
* Coverage matrix lists the tools for each resource.
* Not yet verified against a live instance: payload shapes for layouts, report groups and dashboard widgets, and the UI paths marked "(to confirm)".

### Phase 2: core improvements

* Renamed to HaloForge MCP (`haloforge-mcp` package, server and bin). Based on halo-itsm-mcp (MIT).
* Safety modes: `HALO_MODE` read (default), write or full; `HALO_DISABLE_DELETE` true by default; optional `HALO_WRITE_ALLOWLIST`; all settable per instance.
* Dry run with a field by field before and after diff on every create or update tool.
* Safe merge of nested arrays (ticket type fields and user fields, workflow steps and stages, and any array matched by `id`), with `_remove`, `merge`, `replace_arrays` and `full_object` options. Unchanged updates are skipped.
* Audit log of every write in `logs/audit.jsonl` (field paths only, secrets masked).
* Several instances with `HALO_INSTANCES`; optional `instance` argument on every tool; `halo_instances_list`. The original single instance variables still work.
* Output control: `fields`, `all_pages`, `max_items`, compact summaries with an explicit notice instead of silent truncation. List responses with named record keys (for example `tickets`) are now unwrapped.
* Batch writes: create or update tools accept a list sent in one API call.
* Reliability: proxy support through `HTTPS_PROXY` and `NO_PROXY`, clearer authentication and network errors, retries with backoff for reads (writes retried only on 429), tenant support on token requests.
* `halo_api_request` general fallback.
* ESLint and vitest with a mocked fetch.

### Phase 1: coverage matrix

* Catalogue of 96 configuration resources and a read only matrix generator (`npm run coverage-matrix`).
