# API

Base path: `/api`. Every response is one of the two shapes in
`shared/src/types/api.ts`:

```jsonc
{ "success": true, "data": /* ... */, "meta"?: {} }
{ "success": false, "error": { "code": "...", "message": "...", "errorId": "...", "fieldErrors"?: {} } }
```

`errorId` correlates to a server-side log line with full technical detail -
never expect (or parse) more detail from the response body itself.

## Endpoints (Phases 1-8)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | - | Sets the refresh cookie; body has `email`, `password` |
| POST | `/api/auth/refresh` | refresh cookie | Rotates the refresh token, returns a new access token |
| POST | `/api/auth/logout` | refresh cookie | Revokes the refresh token, clears the cookie |
| GET | `/api/auth/me` | bearer token | Returns the current `AuthenticatedUser` |
| GET | `/api/audit` | bearer + `audit.view` | `?limit=` (max 200), newest first |
| GET | `/api/jobs` | bearer + `job.view` | `?limit=` (max 200), newest first |
| POST | `/api/jobs/:id/cancel` | bearer + `job.manage` | Only a `QUEUED` job can be cancelled |
| GET | `/api/system-health` | - | Bare liveness probe: `{ status: "UP" }` |
| GET | `/api/system-health/detail` | bearer + `system.health.view` | DB connectivity + job queue depth |
| GET | `/api/master-data/employees` | bearer + `masterdata.view` | Paginated (`page`, `pageSize`, `search`, `departmentId`, `locationId`) |
| GET | `/api/master-data/{locations,departments,processes,designations,shifts,queues,skills}` | bearer + `masterdata.view` | Simple reference lists |
| GET | `/api/master-data/lookups/hods` | bearer + `masterdata.view` | Distinct Unit HODs |
| GET | `/api/master-data/lookups/tls?hodId=` | bearer + `masterdata.view` | Team Leaders under that HOD |
| GET | `/api/master-data/lookups/agents?tlId=` | bearer + `masterdata.view` | Employees reporting to that TL - powers the Global Filter Bar's HOD->TL->Agent/Senior cascade |
| GET | `/api/master-data/holidays` | bearer + `masterdata.view` | Holiday calendar |
| POST/PATCH | `/api/master-data/{employees,locations,departments,processes,queues,skills,shifts,holidays}` | bearer + `masterdata.manage` | Create / deactivate (PATCH deactivates - there is no hard delete on master data) |
| GET | `/api/users` | bearer + `user.view` | Paginated (`page`, `pageSize`, `search`), includes each user's roles |
| GET | `/api/users/roles` | bearer + `user.view` | The role catalog, for a role-picker UI |
| POST | `/api/users` | bearer + `user.manage` | Create a user (email, password, displayName, roleCodes) |
| PATCH | `/api/users/:userId/roles` | bearer + `role.manage` | Replace a user's role grants |
| PATCH | `/api/users/:userId/active` | bearer + `user.manage` | Activate/deactivate a user |
| GET | `/api/imports` | bearer + `import.view` | Paginated import run history with counts and status |
| POST | `/api/imports/org-hierarchy?fileName=` | bearer + `import.execute` | Body is the raw file text (not JSON) - runs the org-hierarchy pipeline |
| GET | `/api/imports/data-quality` | bearer + `dataquality.view` | Paginated, `?status=OPEN\|ACKNOWLEDGED\|RESOLVED\|IGNORED` |
| PATCH | `/api/imports/data-quality/:id` | bearer + `dataquality.view` | Body `{ status }` - resolve/acknowledge/ignore a finding |
| GET | `/api/roster/requirements` | bearer + `roster.view` | Paginated, `?status=&from=&to=` |
| GET | `/api/roster/requirements/:id` | bearer + `roster.view` | Returns `{ requirement, actions, assignments }` - the full detail + decision timeline |
| POST | `/api/roster/requirements` | bearer + `roster.submit` | Creates a requirement in status `SUBMITTED` |
| POST | `/api/roster/requirements/:id/review` | bearer + `roster.view` (permission decided by the requirement's current status - see `documentation/roster.md`) | Body `{ decision: "APPROVE"\|"REJECT"\|"SEND_BACK", comments? }` |
| POST | `/api/roster/requirements/:id/assignments` | bearer + `roster.review.leader` | Body `{ employeeId }` - proposes an employee to fill the requirement |
| DELETE | `/api/roster/requirements/:id/assignments/:employeeId` | bearer + `roster.review.leader` | Removes a proposed assignment |
| GET | `/api/roster/published` | bearer + `roster.view` | `?from=&to=` (both required), paginated - the active `PublishedRoster` rows |
| GET | `/api/roster/change-impact` | bearer + `roster.change` | `?employeeId=&businessDate=&newShiftId=` - read-only Change Impact Simulator, writes nothing |
| POST | `/api/roster/changes` | bearer + `roster.change` | Body `{ employeeId, businessDate, newShiftId, reason }` - confirms a shift change |
| GET | `/api/roster/changes` | bearer + `roster.view` | Paginated history of confirmed roster changes |
| GET | `/api/attendance` | bearer + `attendance.view` | Paginated daily attendance summaries, `?from=&to=&employeeId=` (`from`/`to` required) |
| GET | `/api/attendance/sessions` | bearer + `attendance.view` | `?employeeId=&businessDate=` (both required) - raw sessions for one employee/day |
| POST | `/api/attendance/sessions` | bearer + `attendance.manage` | Manual entry: `{ employeeId, businessDate, sessionStart, sessionEnd?, breakMinutes?, reason? }` |
| PATCH | `/api/attendance/sessions/:id` | bearer + `attendance.manage` | Adjustment: `{ sessionStart?, sessionEnd?, breakMinutes?, reason }` - `reason` is mandatory |
| DELETE | `/api/attendance/sessions/:id` | bearer + `attendance.manage` | Body `{ reason }` - `reason` is mandatory |
| GET | `/api/business-day/today` | bearer | `{ businessDate, timezone }` - the company-wide business date right now (`resolveGlobalBusinessDate`) |
| GET | `/api/calls/queue-intervals` | bearer + `calls.view` | `?from=&to=&queueId=`, paginated - queue-grain call-detail rows, see `documentation/phone-system-mapping.md` |
| GET | `/api/calls/agent-intervals` | bearer + `calls.view` | `?from=&to=&agentId=&queueId=`, paginated - agent-grain call-detail rows |
| POST | `/api/calls/import/:source` | bearer + `import.execute` | Multipart `.xlsx` upload (field `file`) - `:source` is one of `vonage-queuewise`, `vonage-company-summary`, `elevate`, `ringcentral-calls` |
| GET | `/api/calls/metrics/by-queue` | bearer + `calls.view` | `?from=&to=&queueId=` - Answer/Abandon Rate %, AHT, Service Level %, Workload Hours per (BusinessDate, Queue) |
| GET | `/api/calls/metrics/by-process` | bearer + `calls.view` | `?from=&to=&processId=` - same, rolled up to (BusinessDate, Process); only includes queues with a Process assigned (Admin > Queues) |
| GET | `/api/shrinkage/categories` | bearer + `shrinkage.view` | The seeded category list (Planned Leave, Training, Break, ...) |
| GET | `/api/shrinkage` | bearer + `shrinkage.view` | Paginated daily shrinkage summaries, `?from=&to=&employeeId=` (`from`/`to` required) |
| GET | `/api/shrinkage/entries` | bearer + `shrinkage.view` | `?employeeId=&businessDate=` (both required) - raw entries for one employee/day |
| POST | `/api/shrinkage/entries` | bearer + `shrinkage.manage` | Manual entry: `{ employeeId, businessDate, shrinkageCategoryId, minutes, notes? }` |
| PATCH | `/api/shrinkage/entries/:id` | bearer + `shrinkage.manage` | Adjustment: `{ minutes?, shrinkageCategoryId?, notes?, reason }` - `reason` is mandatory |
| DELETE | `/api/shrinkage/entries/:id` | bearer + `shrinkage.manage` | Body `{ reason }` - `reason` is mandatory |
| GET | `/api/staffing/coverage` | bearer + `staffing.view` | Paginated, `?from=&to=&departmentId=&processId=` (`from`/`to` required) - per published roster requirement |
| GET | `/api/staffing/capacity` | bearer + `staffing.view` | `?from=&to=&processId=` - Required Productive HC/Capacity Hours/Capacity Utilization %/Occupancy % per (BusinessDate, Process) |
| GET | `/api/forecast` | bearer + `forecast.view` | `?from=&to=&queueId=` - the deterministic call-volume forecast per (BusinessDate, Queue); a date with insufficient real history reports `null` factors, never a guess |
| GET | `/api/forecast/accuracy` | bearer + `forecast.view` | `?from=&to=&queueId=` - MAE/MAPE/Bias comparing each date's forecast against its real actual, wherever both exist |
| GET | `/api/control-tower/summary` | bearer + `controltower.view` | `?from=&to=&processId=&hodId=&tlId=&agentSeniorId=&designationCode=` - the Control Tower's 12 KPIs; see `documentation/controltower.md` for which respect the full filter cascade |
| GET | `/api/formulas` | bearer + `formula.view` | The active Formula Library catalog |
| GET | `/api/formulas/ledger` | bearer + `formula.view` | Paginated, `?formulaCode=&entityType=&entityId=&from=&to=` - the Calculation Ledger, newest first |
| PATCH | `/api/master-data/queues/:id/process` | bearer + `masterdata.manage` | Body `{ processId: number \| null }` - assigns/clears a queue's Process, needed for Calls workload to attribute to a Staffing process |

Every future module's endpoints follow the
same envelope, auth (`requireAuth`), authorization
(`requirePermission("module.action")`) and validation (`zod`, surfaced as
`fieldErrors`) pattern - see `backend/src/modules/auth` as the reference
implementation of that pattern.
