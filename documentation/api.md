# API

Base path: `/api`. Every response is one of the two shapes in
`shared/src/types/api.ts`:

```jsonc
{ "success": true, "data": /* ... */, "meta"?: {} }
{ "success": false, "error": { "code": "...", "message": "...", "errorId": "...", "fieldErrors"?: {} } }
```

`errorId` correlates to a server-side log line with full technical detail -
never expect (or parse) more detail from the response body itself.

## Endpoints (Phase 1)

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

Every future module's endpoints (`/api/roster`, `/api/calls`, ...) follow the
same envelope, auth (`requireAuth`), authorization
(`requirePermission("module.action")`) and validation (`zod`, surfaced as
`fieldErrors`) pattern - see `backend/src/modules/auth` as the reference
implementation of that pattern.
