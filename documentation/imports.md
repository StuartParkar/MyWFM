# Import Center

Stub. This becomes real in Phase 3: Upload -> Staging -> Format Validation ->
Source Mapping -> Normalization -> Duplicate Check -> Data Quality -> Merge ->
Aggregation -> Calculation -> Ledger (build spec section 29), with a unique
`IMPORT-00000001`-style id per file and full duplicate/business-key handling
(section 30).

## What already exists that Phase 3 will build on

- `imports/templates/`, `imports/samples/`, `imports/rejected/` folder
  structure (`imports/*/README.md` explain each).
- `imports/samples/master-data/` holds a **real** organizational hierarchy
  sample (not a phone-system import, but the same "inspect the real file
  before building the mapping" discipline build spec section 76 asks for) -
  see that folder's README for the concrete data-quality findings (alias-based
  leader references, `TBA-*` vacant placeholders, inconsistent null
  representation, combined `Process` values) that Phase 3's Data Quality
  Center design should generalize from.
- The background job queue (`backend/src/modules/jobs/jobQueue.ts`) that
  imports will enqueue onto, already durable and worker-polled.
- The audit log that every import's outcome will write into.

Nothing about parsing, validation rules, or the universal call/roster/
attendance models is built yet - see `phone-system-mapping.md` for the
call-specific piece of this.
