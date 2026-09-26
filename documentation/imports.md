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
system exists for either. Calls (three phone systems) are the pipeline's
next real candidate, but are explicitly **not** built until real sample
files are provided - see `phone-system-mapping.md` and build spec section 76
("do not invent columns"); the universal call *schema* it would eventually
load into already exists (`documentation/database.md`'s `calls` schema), just
with no importer feeding it yet. The current file-upload endpoint accepts raw
text (`express.text()`) because TSV/CSV is what exists today; a binary format
(e.g. Excel) will need a multipart upload (`multer`/`formidable`) added when
a real source needs it - not before.
