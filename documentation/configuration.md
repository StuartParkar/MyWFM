# Configuration

See `config/README.md` for the two-layer summary. This doc lists what exists
today in each layer.

## Layer 1 - environment variables

| File | Used by |
|---|---|
| `backend/.env.example` | The Express API (`backend/src/config/env.ts`) |
| `frontend/.env.example` | `next.config.ts`'s `/api/*` rewrite target |
| `.env.example` (root) | `docker-compose.yml` |

`backend/src/config/env.ts` validates these eagerly at boot with `zod` -
a missing or malformed value fails startup immediately with a readable
message, rather than failing confusingly deep inside the DB driver later.

## Layer 2 - versioned application configuration

Stored in `config.ConfigurationSetting`, seeded with real defaults by
`database/seed-data/0002_default_configuration.sql`, read through
`backend/src/config/appConfig.ts` (`getConfigString`/`getConfigNumber`/
`getConfigBoolean`, each taking a fallback used if the database is
unreachable or the key is missing).

| Key | Category | Default | Meaning |
|---|---|---|---|
| `business_day.timezone` | BUSINESS_DAY | `Asia/Kolkata` | IANA timezone the Business Day Engine resolves business dates in (`documentation/attendance.md`) |
| `business_day.start_time` | BUSINESS_DAY | `00:00` | Company-wide business-day start cutoff (`resolveGlobalBusinessDate`) - the default makes the global business date identical to the plain calendar date |
| `attendance.late_grace_minutes` | ATTENDANCE | `5` | Minutes after Scheduled Start before a late first login counts as late |
| `attendance.early_logout_grace_minutes` | ATTENDANCE | `5` | Minutes before Scheduled End an early last logout is still tolerated |
| `attendance.double_shift_min_gap_hours` | ATTENDANCE | `5` | Minimum gap between two sessions the same day before DOUBLE_SHIFT_EXCEPTION is raised |
| `security.access_token_ttl_minutes` | SECURITY | `15` | JWT lifetime |
| `security.refresh_token_ttl_days` | SECURITY | `7` | Refresh token lifetime |
| `security.password_min_length` | SECURITY | `10` | Enforced by `validatePasswordPolicy` |
| `security.max_failed_login_attempts` | SECURITY | `5` | Before temporary lockout |
| `security.account_lockout_minutes` | SECURITY | `15` | Lockout duration |

There is no admin UI over this table yet (that's Phase 7/12's Configuration
Center screen) - today it's edited by inserting a new `Version` row directly
(see `database/schema/README.md` on why edits are always new rows, never
`UPDATE`s, enforced by a filtered unique index).
