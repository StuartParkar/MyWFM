# Universal MyWFM Documentation

| Doc | Covers |
|---|---|
| [`architecture.md`](./architecture.md) | System overview, data flow, project structure, why each technology was chosen |
| [`database.md`](./database.md) | Schema conventions, current tables, migration runner, programmability objects |
| [`security.md`](./security.md) | Authentication, RBAC, password/token handling, audit logging |
| [`api.md`](./api.md) | REST API conventions and the current endpoint list |
| [`configuration.md`](./configuration.md) | Environment variables vs. versioned application configuration |
| [`deployment.md`](./deployment.md) | Local dev, Docker Compose, and production deployment |
| [`backup-restore.md`](./backup-restore.md) | Using `scripts/backup-mywfm.*`/`scripts/restore-mywfm.*`, and the guided Backup/Restore screen that automates backup (not restore) on top of them |
| [`testing.md`](./testing.md) | What's tested today and how to run it |
| [`troubleshooting.md`](./troubleshooting.md) | Common failure modes and what to check |
| [`roster.md`](./roster.md) | Roster requirement/approval/publication workflow and the Change Impact Simulator |
| [`attendance.md`](./attendance.md) | The Business Day Engine and attendance sessions/formulas |
| [`formulas.md`](./formulas.md) | The Calculation Engine/Ledger, and every formula real data supports today (Shrinkage, Staffing, Calls, Forecast) |
| [`controltower.md`](./controltower.md) | The Control Tower's 12 KPIs, why they use two different filter scopes, and Explain This Number |
| [`intraday.md`](./intraday.md) | Interval-bucketing engine, Break Management, the exception engine and OT/VTO |
| [`workforce.md`](./workforce.md) | Workforce Planning (Current/Required/Future HC, Hiring Gap) and Scenario Planning |
| [`attrition.md`](./attrition.md) | Opening/Closing HC, Joiners, Exits, Transfers, Attrition Rate - and where the join/exit dates actually come from |
| [`lineage-and-reprocessing.md`](./lineage-and-reprocessing.md) | Data Lineage's InputsSnapshot/SourceReference drilldown, and authorized/audited on-demand Reprocessing |
| [`reports.md`](./reports.md) | The six period-comparison Reports screens and Custom Reports' ad-hoc Ledger query tool |
| [`imports.md`](./imports.md) | Import Center - the org-hierarchy and calls pipelines |
| [`phone-system-mapping.md`](./phone-system-mapping.md) | Phone-system source mappings (Vonage, Elevate, RingCentral) |

This documentation set is itself phased: a doc describes what actually exists
in the code today, and says plainly which build-spec sections it does not
cover yet rather than describing planned behavior as if it were real (see the
root `README.md`'s phase tracker for what "today" means).
