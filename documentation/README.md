# Universal MyWFM Documentation

| Doc | Covers |
|---|---|
| [`architecture.md`](./architecture.md) | System overview, data flow, project structure, why each technology was chosen |
| [`database.md`](./database.md) | Schema conventions, current tables, migration runner, programmability objects |
| [`security.md`](./security.md) | Authentication, RBAC, password/token handling, audit logging |
| [`api.md`](./api.md) | REST API conventions and the current endpoint list |
| [`configuration.md`](./configuration.md) | Environment variables vs. versioned application configuration |
| [`deployment.md`](./deployment.md) | Local dev, Docker Compose, and production deployment |
| [`backup-restore.md`](./backup-restore.md) | Using `scripts/backup-mywfm.*` and `scripts/restore-mywfm.*` |
| [`testing.md`](./testing.md) | What's tested today and how to run it |
| [`troubleshooting.md`](./troubleshooting.md) | Common failure modes and what to check |
| [`formulas.md`](./formulas.md) | Formula & Rule Library - stub until Phase 7 |
| [`imports.md`](./imports.md) | Import Center - stub until Phase 3 |
| [`phone-system-mapping.md`](./phone-system-mapping.md) | Phone-system source mappings - stub until Phase 6 |

This documentation set is itself phased: a doc describes what actually exists
in the code today, and says plainly which build-spec sections it does not
cover yet rather than describing planned behavior as if it were real (see the
root `README.md`'s phase tracker for what "today" means).
