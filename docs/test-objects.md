# Test objects

> **Not run yet against the trial.** The integration tests have not been run against a real instance. When they run, they rewrite this file with the actual objects, IDs and status.

The tests never delete anything. Every object name starts with `MCP TEST |`, and objects are found by name before being created, so rerunning reuses them. During the update check each object is renamed to `<name> (checked)` and back.

Run them with:

```bash
RUN_INTEGRATION=1 npm run test:integration
```

This needs `HALO_TRIAL_BASE_URL`, `HALO_TRIAL_CLIENT_ID`, `HALO_TRIAL_CLIENT_SECRET` and `HALO_TRIAL_MODE=write`. Use `HALO_INTEGRATION_INSTANCE` for another instance name, and `HALO_INTEGRATION_TARGET` to plan the copy against a real second instance instead of a read only alias of the trial.

## Planned objects

| Resource | Name | Purpose |
|---|---|---|
| TicketTypeGroup | MCP TEST \| TicketTypeGroup | Create, update and read back |
| FieldGroup | MCP TEST \| FieldGroup | Create, update and read back |
| Tabs | MCP TEST \| Tabs | Create, update and read back |
| CannedText | MCP TEST \| CannedText | Create, update and read back |
| Template | MCP TEST \| Template | Create, update and read back |
| Outcome | MCP TEST \| Outcome | Create, update and read back |
| ViewFilter | MCP TEST \| ViewFilter | Create, update and read back |
| ViewColumns | MCP TEST \| ViewColumns | Create, update and read back |
| ViewListGroup | MCP TEST \| ViewListGroup | Create, update and read back |
| Workflow | MCP TEST \| Workflow | Create, update and read back |
| ApprovalProcess | MCP TEST \| ApprovalProcess | Create, update and read back |
| CAB | MCP TEST \| CAB | Create, update and read back |
| CABRole | MCP TEST \| CABRole | Create, update and read back |
| EmailTemplate | MCP TEST \| EmailTemplate | Create, update and read back |
| SLA | MCP TEST \| SLA | Create, update and read back |
| Workday | MCP TEST \| Workday | Create, update and read back |
| Team | MCP TEST \| Team | Create, update and read back |
| Roles | MCP TEST \| Roles | Create, update and read back |
| UserRoles | MCP TEST \| UserRoles | Create, update and read back |
| ContactGroup | MCP TEST \| ContactGroup | Create, update and read back |
| Qualification | MCP TEST \| Qualification | Create, update and read back |
| ServiceCategory | MCP TEST \| ServiceCategory | Create, update and read back |
| FAQLists | MCP TEST \| FAQLists | Create, update and read back |
| StyleProfile | MCP TEST \| StyleProfile | Create, update and read back |
| AssetType | MCP TEST \| AssetType | Create, update and read back |
| AssetGroup | MCP TEST \| AssetGroup | Create, update and read back |
| PdfTemplate | MCP TEST \| PdfTemplate | Create, update and read back |
| CSVTemplate | MCP TEST \| CSVTemplate | Create, update and read back |
| Tags | MCP TEST \| Tags | Create, update and read back |
| CostCentres | MCP TEST \| CostCentres | Create, update and read back |
| ResourceType | MCP TEST \| ResourceType | Create, update and read back |
| ReleaseType | MCP TEST \| ReleaseType | Create, update and read back |
| PipelineStages | MCP TEST \| PipelineStages | Create, update and read back |
| TicketType | MCP TEST \| Layout | Layout round trip (two fields swapped and restored) |
| Lookup (report group) | MCP TEST \| Group | Report group for the copy test |
| Report | MCP TEST \| Report | Cloned from an existing report into the test group, then run |
| DashboardLinks | MCP TEST \| Dashboard | Built from a grid with two widgets; exported, compared and copied in dry run |
