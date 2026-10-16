# HaloForge MCP

An MCP server for HaloITSM that can read, and safely configure, what an administrator configures in Halo: ticket types and their layouts, field groups, fields, workflows, rules, SLAs, the portal, the CMDB, reports and dashboards. It is designed to be safe to point at a production instance. By default it cannot write or delete anything.

Based on [halo-itsm-mcp](https://github.com/omichelbraga/halo-itsm-mcp) by omichelbraga (MIT licence). HaloForge keeps the original's tools, transports and OAuth proxy, and adds safety modes, dry runs, safe merges, an audit log, support for several instances and output control.

> Status: version 2.0.0. Every feature below is covered by unit tests against a mocked API, and the integration suite passes against a local fake. It has **not yet been run against a live Halo instance**, so the shapes of a few payloads (layout flags, report groups, dashboard widgets) may need adjusting on first contact. See [CHANGELOG.md](CHANGELOG.md).

Documentation: [tool reference](docs/tools.md), [coverage matrix](docs/coverage-matrix.md), [test objects](docs/test-objects.md).

## Features

* **Safety modes per instance**: `read` (the default) registers no create or update tools; `write` allows create and update; `full` also allows delete, but only when `HALO_DISABLE_DELETE=false` is set explicitly. An optional write allowlist limits which resources can be written.
* **Dry run and diff**: every create or update tool accepts `dry_run: true`. It reads the current record and returns a field by field before and after diff without saving.
* **Safe merge for nested arrays**: Halo replaces nested arrays (ticket type fields, field group fields, workflow steps, dashboard widgets) on update. HaloForge reads the record, merges your change by match key and writes the complete array, so a one field change never wipes a layout.
* **Audit log**: every write is appended to `logs/audit.jsonl` with the time, instance, tool, resource, IDs and the changed field paths (never values). Secrets are masked.
* **Several instances**: `HALO_INSTANCES=trial,prod`. Every tool takes an optional `instance` argument.
* **Output control**: `fields` to return only chosen fields, `all_pages: true` with `max_items`, and a compact summary when output would be too large. Output is never cut off silently.
* **Batch writes**: create or update tools accept a list and send one API call.
* **Reliability**: proxy support (`HTTPS_PROXY` and `NO_PROXY`), clear authentication errors, retries with backoff (reads only, so a create is never sent twice), a rate limiter (700 requests per 5 minutes per instance) and a circuit breaker.
* **General fallback**: `halo_api_request` reaches any API path. GET always works; POST and DELETE follow the instance's mode.
* **Transports**: stdio for Claude Desktop and Claude Code, Streamable HTTP for Docker, and HTTP with an OAuth proxy for the Claude connector UI.

## Safety modes

| Setting | Default | Effect |
|---|---|---|
| `HALO_MODE` | `read` | `read`: list and get only. `write`: also create and update. `full`: also delete (if enabled). |
| `HALO_DISABLE_DELETE` | `true` | Delete tools are registered only when this is `false` and an instance is in `full` mode. |
| `HALO_WRITE_ALLOWLIST` | not set | Comma separated resources that may be written, for example `Report,DashboardLinks,Lookup`. API names (`TicketType`) and tool names (`tickettypes`) both work. |

Each can be set per instance (`HALO_TRIAL_MODE`, `HALO_PROD_DISABLE_DELETE`, `HALO_PROD_WRITE_ALLOWLIST`); per instance values override the global ones.

When several instances are configured, a tool is registered if any instance could use it, and every call is checked against the selected instance. A write aimed at a read mode instance is refused with a clear message. Dry runs only read, so they are allowed on any instance; this lets you preview a change against production without any risk.

## Setup

### Requirements

* Node.js 20 or later
* A HaloITSM API application (Configuration > Integrations > Halo API) using **Client ID and Secret (Services)** with the `all` scope. A newly created application can return 401 for a minute or two.

### Install and build

```bash
git clone https://github.com/DestroyerOfCode12/haloforge-mcp.git
cd haloforge-mcp
npm ci
npm run build
```

### Configure one instance (original variables)

```env
HALO_BASE_URL=https://yourcompany.haloitsm.com
HALO_CLIENT_ID=your_client_id
HALO_CLIENT_SECRET=your_client_secret
HALO_MODE=read
```

### Configure several instances

```env
HALO_INSTANCES=trial,prod

HALO_TRIAL_BASE_URL=https://yourcompany-trial.haloitsm.com
HALO_TRIAL_CLIENT_ID=...
HALO_TRIAL_CLIENT_SECRET=...
HALO_TRIAL_MODE=write

HALO_PROD_BASE_URL=https://yourcompany.haloitsm.com
HALO_PROD_CLIENT_ID=...
HALO_PROD_CLIENT_SECRET=...
HALO_PROD_MODE=read
```

The first instance is the default unless `HALO_DEFAULT_INSTANCE` names another. If neither `HALO_INSTANCES` nor `HALO_BASE_URL` is set, any `HALO_<NAME>_BASE_URL` variables are picked up automatically.

Keep secrets in environment variables or a git ignored `.env` file (see [.env.example](.env.example)). Never commit them.

### Other settings

| Variable | Default | Purpose |
|---|---|---|
| `HALO_AUDIT_LOG` | `logs/audit.jsonl` | Audit log path, or `off` |
| `HALO_MAX_OUTPUT_CHARS` | `80000` | Size at which output becomes a compact summary |
| `HALO_MAX_RETRIES` | `3` | Retries for reads (and for writes only on HTTP 429) |
| `HTTPS_PROXY`, `NO_PROXY` | not set | Outbound proxy; used automatically when set |
| `HALO_DISABLE_PROXY` | not set | `true` ignores proxy variables |
| `HALO_TOOLS` | not set | Register only tools matching these comma separated names (`*` wildcards), for example `halo_ticket_type_layout_*,halo_report*,halo_dashboard*` |
| `HALO_EXPORT_DIR` | `exports` | Folder for exports and documents; tools cannot write outside it |
| `HALO_TOOLS_EXCLUDE` | not set | Leave out tools matching these names, for example `halo_tickets_*,halo_invoices_*` |
| `HALO_SCOPE`, `HALO_TENANT` | `all`, not set | Token scope and tenant (also per instance) |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_AUTH` | `env` | `env` or `oauth` (HTTP only) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

## Claude Desktop

Two instances: the trial in write mode and production in read mode.

### macOS

`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "haloforge": {
      "command": "node",
      "args": ["/Users/you/haloforge-mcp/dist/index.js"],
      "env": {
        "HALO_INSTANCES": "trial,prod",
        "HALO_TRIAL_BASE_URL": "https://yourcompany-trial.haloitsm.com",
        "HALO_TRIAL_CLIENT_ID": "your_trial_client_id",
        "HALO_TRIAL_CLIENT_SECRET": "your_trial_client_secret",
        "HALO_TRIAL_MODE": "write",
        "HALO_PROD_BASE_URL": "https://yourcompany.haloitsm.com",
        "HALO_PROD_CLIENT_ID": "your_prod_client_id",
        "HALO_PROD_CLIENT_SECRET": "your_prod_client_secret",
        "HALO_PROD_MODE": "read",
        "HALO_AUDIT_LOG": "/Users/you/haloforge-mcp/logs/audit.jsonl"
      }
    }
  }
}
```

### Windows

`%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "haloforge": {
      "command": "node",
      "args": ["C:\\Users\\you\\haloforge-mcp\\dist\\index.js"],
      "env": {
        "HALO_INSTANCES": "trial,prod",
        "HALO_TRIAL_BASE_URL": "https://yourcompany-trial.haloitsm.com",
        "HALO_TRIAL_CLIENT_ID": "your_trial_client_id",
        "HALO_TRIAL_CLIENT_SECRET": "your_trial_client_secret",
        "HALO_TRIAL_MODE": "write",
        "HALO_PROD_BASE_URL": "https://yourcompany.haloitsm.com",
        "HALO_PROD_CLIENT_ID": "your_prod_client_id",
        "HALO_PROD_CLIENT_SECRET": "your_prod_client_secret",
        "HALO_PROD_MODE": "read",
        "HALO_AUDIT_LOG": "C:\\Users\\you\\haloforge-mcp\\logs\\audit.jsonl"
      }
    }
  }
}
```

Set `HALO_AUDIT_LOG` to an absolute path, because Claude Desktop starts the server from its own working directory.

### Claude Code

```bash
claude mcp add haloforge -e HALO_BASE_URL=https://yourcompany.haloitsm.com \
  -e HALO_CLIENT_ID=... -e HALO_CLIENT_SECRET=... -- node /path/to/haloforge-mcp/dist/index.js
```

## HTTP, Docker and the OAuth proxy

The original HTTP transports are unchanged:

* `MCP_TRANSPORT=http MCP_AUTH=env`: credentials from the environment, MCP endpoint at `/mcp`, health check at `/health`.
* `MCP_TRANSPORT=http MCP_AUTH=oauth`: only `HALO_BASE_URL` (and `MCP_PUBLIC_URL`) are needed; the MCP client supplies the Halo client ID and secret through the standard OAuth flow and the server exchanges them with Halo using client credentials. Safety settings (`HALO_MODE` and the rest) still apply.

```bash
docker compose up -d --build
```

The compose file mounts `./logs` for the audit log. TLS is expected to be handled by a reverse proxy.

## Using the tools

Every resource has `halo_<resource>_list` and `halo_<resource>_get`, plus `_upsert` and `_delete` when the mode allows. The original resources keep their names (for example `halo_tickettypes_*`); the 66 configuration resources added by HaloForge use the API name in lower case (for example `halo_fieldgroup_*`, `halo_outcome_*`, `halo_dashboardlinks_*`). List and get tools accept `extra_params` for any other Halo query parameter. [docs/coverage-matrix.md](docs/coverage-matrix.md) maps each area to its tools.

That is over 400 tools in full mode. If your client struggles with that many, narrow them with `HALO_TOOLS` or `HALO_TOOLS_EXCLUDE`.

### Higher level tools

| Tool | Purpose |
|---|---|
| `halo_ticket_type_layout_get` | A ticket type's layout as field groups in order, each field named with its sequence, agent and end user visibility flags, restrictions and display settings, plus the user panel |
| `halo_ticket_type_layout_set` | Add, move, change, reorder or take out layout fields by ID or name; everything else is kept; dry run diff |
| `halo_field_group_get` | A field group's fields with visibility conditions and the ticket types that use it |
| `halo_field_group_set` | Change group settings and fields, including visibility conditions; dry run diff |
| `halo_reports_run` | Run a report: row count, columns, sample rows and counts per value for a column |
| `halo_reports_clone` | Copy a report with a new name, SQL, group (by ID or name) or chart settings; rejects SQL with `--` comments |
| `halo_report_groups_list` / `_create` | Report groups (lookup 41); create skips names that already exist |
| `halo_dashboard_build` | Create or update a dashboard from a grid: writes the 12 column `lg` layout, keeps other breakpoints, checks overlaps, grants all agents view access |
| `halo_schema_get` | A resource's methods and model fields from the instance's API spec |
| `halo_config_probe` | The shape of a resource's list and detail responses (keys, types, counts; never values) |

### Moving configuration between instances

| Tool | Purpose |
|---|---|
| `halo_config_export` | Export chosen areas or resources (or all configuration) to JSON, one file per object, with a manifest. Sensitive values are masked |
| `halo_config_compare` | Compare two instances, or an export against an instance, matched by name: missing, only in target, and changed field paths. IDs and dates are ignored |
| `halo_config_copy` | Copy chosen objects to another instance with references mapped by name. Dry run by default with a full ordered plan |
| `halo_config_document` | A markdown summary of an instance's configuration for handover documents |

Files are written under the export folder: `HALO_EXPORT_DIR`, default `./exports` (git ignored). Paths outside it are refused. Selecting by area skips record like resources (agents, users, clients, sites, articles, items, suppliers, contracts, licences, downtime) unless `include_data: true`.

`halo_config_copy` maps references by name: report groups (lookup 41), teams, agents, statuses, fields, field groups, ticket types, SLAs, priorities, workflows and reports, including the report IDs in dashboard widgets. Copying a report group brings its reports, and copying a dashboard brings the reports its widgets use and their groups (turn off with `include_dependencies: false` and `include_group_reports: false`). Objects are created in dependency order and new IDs are fed into later steps. Objects that already exist on the target by name are skipped, or updated with `on_existing: "update"`. Applying (`dry_run: false`) needs the target in write mode and is refused while any reference cannot be mapped, unless `allow_unresolved: true`. Sensitive values (passwords, secrets, tokens) are never copied.

```text
halo_config_copy { "source_instance": "trial", "target_instance": "prod",
                   "items": [{ "resource": "ReportGroup", "name": "MCP TEST | Service desk" },
                             { "resource": "DashboardLinks", "name": "MCP TEST | Service desk" }] }
```

Some examples:

```text
halo_tickettypes_list   { "fields": ["id", "name"], "all_pages": true }
halo_tickettypes_get    { "id": 12, "includedetails": true, "fields": ["id", "name", "fields"] }
halo_tickettypes_upsert { "data": { "id": 12, "fields": [{ "fieldid": 205, "seq": 3 }] }, "dry_run": true }
halo_reports_upsert     { "instance": "trial", "data": [{ "name": "MCP TEST | Open by team" }, { "name": "MCP TEST | Closed by team" }] }
halo_api_request        { "method": "GET", "path": "/Lookup", "query": { "lookupid": 41 } }
halo_instances_list     {}
halo_ticket_type_layout_set { "ticket_type_id": 12, "changes": [{ "field_name": "MCP TEST | Reason", "group_name": "Details", "seq": 4 }], "dry_run": true }
halo_dashboard_build    { "name": "MCP TEST | Team board", "widgets": [{ "type": "report_chart", "report_id": 30, "x": 0, "y": 0, "w": 8, "h": 4 }, { "type": "ticket_counter", "x": 8, "y": 0, "w": 4, "h": 2 }], "dry_run": true }
```

### Nested array merge

For an update, items in a nested array are matched by key (`fieldid` for ticket type fields, `id` for workflow steps and most other arrays):

* `{ "fieldid": 205, "seq": 3 }` changes the matching item and keeps every other field on it.
* An item with no match is appended.
* `{ "fieldid": 205, "_remove": true }` takes the item out of the array (it does not delete the field).

Use `merge: false` to send data exactly as given, `replace_arrays: ["fields"]` to replace one array, and `full_object: true` to send the whole current record with your change applied. Updates that would change nothing are skipped.

## Relationship to Halo's native MCP

Halo ships its own MCP endpoint at `{base}/api/mcp`. It covers service desk work (tickets, knowledge base, users, sites, clients and assets) and has no configuration tools. HaloForge focuses on configuration and administration and does not try to duplicate the native server's service desk tools. Use both side by side: the native MCP for day to day ticket work, HaloForge for building and reviewing configuration.

## Development

```bash
npm run build              # compile TypeScript
npm run lint               # ESLint
npm test                   # unit tests (vitest, fetch is mocked); integration tests are skipped
npm run tools-doc          # regenerate docs/tools.md from the tool definitions
npm run coverage-matrix    # regenerate docs/coverage-matrix.md (add -- --live to query an instance, read only)
```

### Integration tests

The integration suite runs against a trial instance only when `RUN_INTEGRATION=1` is set:

```bash
RUN_INTEGRATION=1 npm run test:integration
```

It needs `HALO_TRIAL_BASE_URL`, `HALO_TRIAL_CLIENT_ID`, `HALO_TRIAL_CLIENT_SECRET` and `HALO_TRIAL_MODE=write`. It reads every matrix area, creates and updates one `MCP TEST |` object per safe writable area and reads it back, does a ticket type layout round trip, and builds, exports, compares and copies (dry run) a report group, report and dashboard. It never deletes anything, refuses instances named like production, only updates records whose name starts with `MCP TEST |`, reuses objects on later runs, and lists them in [docs/test-objects.md](docs/test-objects.md).

To check the suite itself without an instance, run it against the local fake:

```bash
npm run fake-halo -- 8787 &
RUN_INTEGRATION=1 HALO_TRIAL_BASE_URL=http://127.0.0.1:8787 HALO_TRIAL_CLIENT_ID=x \
  HALO_TRIAL_CLIENT_SECRET=fake-secret HALO_TRIAL_MODE=write HALO_AUDIT_LOG=off npm run test:integration
git checkout docs/test-objects.md   # the fake run rewrites it with fake IDs
```

Rules for contributions: never delete anything on an instance during development (rename or deactivate instead), prefix test objects with `MCP TEST |`, use only a trial instance, and keep company names, client names, instance URLs, record data and secrets out of code, docs, tests and commit messages.

## Licence

MIT. See [LICENSE](LICENSE). Original work by omichelbraga ([halo-itsm-mcp](https://github.com/omichelbraga/halo-itsm-mcp)).
