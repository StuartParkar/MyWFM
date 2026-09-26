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

Every future module's endpoints (`/api/roster`, `/api/calls`, ...) follow the
same envelope, auth (`requireAuth`), authorization
(`requirePermission("module.action")`) and validation (`zod`, surfaced as
`fieldErrors`) pattern - see `backend/src/modules/auth` as the reference
implementation of that pattern.
