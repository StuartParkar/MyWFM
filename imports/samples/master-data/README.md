# Master Data Samples

This folder holds **real** organizational reference data supplied directly by the
business owner, used to design the Phase 2 master-data schema (employees, org
hierarchy, process, department). It is **not** demo/synthetic data - do not treat it
as a fixture and do not delete it. It is kept separate from
`database/seed-data/` because that folder is reserved exclusively for clearly
labelled `DEMO DATA` used in local development (see spec rule "Never mix demo data
with production data").

## Files

### `employee-org-hierarchy-2026-09-26.tsv`

Provided by stuart@absoluteholidays.com via chat on 2026-09-26. Tab-separated,
header row included, transcribed byte-for-byte from the pasted table (including
its inconsistencies - see Data Quality Observations below; those are intentionally
**not** cleaned up here because fixing them is the job of the Phase 3 Data Quality /
Normalization subsystem, not this transcription).

**Follow-up expected:** the same source said joining and leaving dates will be
provided separately. When they arrive, add them as a second file
(`employee-dates-<date>.tsv`) keyed by `Emp ID` rather than editing this file, so
each drop stays traceable to when it was received.

## Column mapping to the target schema

| Source column | Meaning | Target (Phase 2) |
|---|---|---|
| `Emp ID` | Company/HR employee number | `Employee.EmployeeCode` (business key, NOT the surrogate PK - see spec section 58) |
| `Name` | Legal/registered name | `Employee.FullName` |
| `Alias Name` | Operational floor nickname | `Employee.AliasName` - likely the join key to phone-system agent names in Phase 6 call imports; keep it, do not discard |
| `Location` | Site code (`DEL` = Delhi, `CHD` = Chandigarh observed so far) | `Location.LocationCode` master table |
| `Process` | Campaign/process code (`ABS`, `LBF`, `FKT-NZ`, `LBF-TSS`, and combined values like `ABS/LBF` for shared-service staff who support both) | `Process.ProcessCode` master table. Combined values are **not** split automatically - see observations below |
| `Department` | Functional department (`English Sales`, `Spanish Sales`, `Hotels`, `IT`, `Finance`, `WFM`, ...) | `Department.DepartmentName` master table |
| `SME` | Subject Matter Expert assigned to the employee, or `-` | `Employee.SmeEmployeeId` (self-referencing FK, resolved by alias - nullable) |
| `Team Leader` | Direct floor supervisor | `Employee.TeamLeaderEmployeeId` (self-referencing FK, resolved by alias) |
| `AM` | Assistant Manager | `Employee.AmEmployeeId` (self-referencing FK, resolved by alias) |
| `Manager` | Manager | `Employee.ManagerEmployeeId` (self-referencing FK, resolved by alias) |
| `Sr. Manager` | Senior Manager | `Employee.SrManagerEmployeeId` (self-referencing FK, resolved by alias) |
| `Unit HOD` | Head of Department for the whole unit | `Employee.UnitHodEmployeeId` (self-referencing FK, resolved by alias) |

## Data quality observations (real findings from this sample, informing Phase 3 design)

1. **Hierarchy is encoded by Alias Name, not Emp ID.** E.g. Team Leader `Kam` refers
   to the row where `Alias Name = Kam` (Emp ID 100455, Kapil Taluja). The import
   normalizer must resolve every leader column from alias to `EmployeeId` and flag
   any alias that does not resolve to exactly one active employee.
2. **Vacant/placeholder leader positions exist.** `TBA-Paul` and `TBA-George` appear
   as Team Leader values (e.g. rows for Emp ID 100708, 100829). These are not real
   employees ("To Be Assigned"). The schema must allow a leader reference to be
   either a resolved `EmployeeId`, a named vacant placeholder, or null - it must not
   be treated as a data-quality error.
3. **The org hierarchy has more than the two levels (TL/HOD) the base spec names.**
   Real layers observed: `SME` → `Team Leader` → `AM` → `Manager` → `Sr. Manager` →
   `Unit HOD`, and not every employee has all layers populated (many go straight
   from Team Leader to Unit HOD with `-` in between). The schema must model this as
   a flexible self-referencing hierarchy (each leader column is its own nullable FK
   on `Employee`), not a fixed two-level TL/HOD pair.
4. **"None" is represented inconsistently.** Most blank cells use `-`, but at least
   one row (Emp ID 100843) has a genuinely empty `SME` cell instead of `-`. Both must
   normalize to `NULL`.
5. **`Process` sometimes holds a combined value** (`ABS/LBF`) for shared-service
   employees (Finance, HR, IT, Transport, Operations, WFM) who are not tied to a
   single process. Do not force-split this into two rows during import; model it as
   the literal value it is unless the business says otherwise, and let Phase 2
   design decide whether shared-service staff need a many-to-many
   Employee-to-Process table instead of the single FK regular agents use.
6. **A leader can also be an individual contributor row with `-` in every leader
   column above their own level** (e.g. Emp ID 100299, Manish Saini, alias `Hugh`,
   is himself the `Unit HOD` value used throughout the sheet). Self-references are
   expected and must not be flagged as errors.

None of this is acted on yet - Phase 1 (currently in progress) only builds the
security/config/audit/system foundation. This file and its observations are the
input Phase 2 (master data: employees, departments, processes, HOD, TL,
designation, shifts, queues, skills) will build the real schema and import mapping
from, instead of a guessed one.
