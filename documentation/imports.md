# Import Center

Generic pipeline (build spec section 29): Upload -> Staging -> Validation ->
Normalization -> Duplicate Check -> Data Quality -> Merge, tracked end to end
in `import.ImportRun` (displayed as `IMPORT-00000001`-style codes) with every
anomaly recorded as an `import.DataQualityIssue` row rather than a log line
that scrolls away.

## What's wired up (Phase 3)

One real source type: the employee/organization hierarchy file (the same
real data Phase 2's schema was designed from). `POST /api/imports/org-hierarchy`
(Admin > Data > Import Center screen) runs an uploaded file through the full
pipeline; `npm run import:org-hierarchy --workspace=backend` runs the same
pipeline against the fixed sample path as a CLI convenience. Both call the
same `backend/src/modules/imports/orgHierarchyImporter.ts` - there is only
one implementation of this logic.

## What's wired up (Phase 6): Calls

Four more real source types - real phone-system call-detail exports, not
pre-aggregated intervals (see `documentation/phone-system-mapping.md` and
`imports/samples/calls/README.md` for the full column-by-column mapping and
every data-quality finding that shaped it):

| Source key | Phone system | Sheet expected |
|---|---|---|
| `vonage-queuewise` | Vonage | `Vonage QueueWise` |
| `vonage-company-summary` | Vonage | `Vonage - Company Summary` |
| `elevate` | Elevate | `Elevate` |
| `ringcentral-calls` | RingCentral | `Calls` |

`POST /api/calls/import/:source` (multipart `.xlsx` upload, `import.execute`
+ Data > Import Center screen) runs an uploaded file through
`backend/src/modules/calls/callsImporter.ts` - staging, alias resolution,
data-quality flagging, then inserting into whichever of
`calls.QueueIntervalCall`/`calls.AgentIntervalCall` each row's grain
requires (never both, never fabricated); `npm run import:calls
--workspace=backend -- <source>` runs the same pipeline against the fixed
sample path for that source as a CLI convenience. Operations > Calls reads
the result back out (`GET /api/calls/queue-intervals`,
`GET /api/calls/agent-intervals`).

Concretely, each run:

1. **Validates**: rejects rows missing Emp ID or Name (`MISSING_REQUIRED_FIELD`, HIGH).
2. **Duplicate-checks**: an Emp ID appearing twice in the same file is flagged
   (`DUPLICATE_ROW`, MEDIUM) and only the first occurrence is used. A
   re-upload of an already-imported employee is not a "duplicate" in this
   sense - it's a normal update (see Records Inserted vs. Updated below).
3. **Normalizes**: upserts Location/Department/Process lookups, splits a
   combined Process value (`ABS/LBF`) into multiple `EmployeeProcess` rows.
4. **Merges**: `MERGE ... OUTPUT $action` classifies each row as an insert or
   an update against `master.Employee` by `EmployeeCode` (the business key) -
   never a blind append, per section 30.
5. **Data quality**: resolves each leader alias, raising `VACANT_LEADER_PLACEHOLDER`
   (LOW, informational - `TBA-*` values), `MULTI_VALUE_CELL` (MEDIUM - a cell
   naming more than one person), `UNRESOLVED_LEADER_ALIAS` (HIGH - an alias
   matching no employee), or `DUPLICATE_ALIAS` (MEDIUM - two employees
   sharing one alias).

See `imports/samples/master-data/README.md` for where these specific
anomalies were first observed in the real data.

## What's still a stub

No other source type runs through this pipeline yet. Roster (Phase 4) and
Attendance (Phase 5) turned out not to need it at all - both are populated by
direct data entry through their own screens (a roster requirement, a manual
attendance session), not an uploaded file, since no real external source
system exists for either. The employee/organization hierarchy upload accepts
raw text (`express.text()`, TSV/CSV); Calls uses a multipart upload
(`multer`) instead, since a real phone-system export is a binary `.xlsx`
workbook, not text - both live side by side in Import Center rather than
one replacing the other.

RingCentral's own `RingCentral` and `RingCentral - AgentWise` sheets (from
the same workbook the four mapped sources came from) were inspected but are
explicitly **not** mapped - one is a pre-aggregated per-agent KPI rollup
(wrong grain for a call-detail fact table), the other is call-detail but a
structurally different, apparently multi-row-per-call export that needs its
own inspection pass. See `imports/samples/calls/README.md` for the full
reasoning. Mapping them, if ever needed, follows section 76 the same way the
four current sources did - inspect the real file first, never guess the
columns.
