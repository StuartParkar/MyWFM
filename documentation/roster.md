# Roster

The requirement -> approval -> publication workflow (build spec sections
10-13). No AI, no auto-generated schedules - every published slot traces back
to a human requirement, a human approval chain, and (for changes) a
before/after simulation the requester saw before confirming.

## The workflow

A requirement moves forward one stage at a time - Requestor submits, Leader
approves, HOD approves, WFM approves - and WFM's approval publishes it:

```
submit          Leader approves   HOD approves      WFM approves
  --> SUBMITTED --------------> HOD_REVIEW ------> WFM_REVIEW --------> PUBLISHED
```

Any stage can reject outright (-> `REJECTED`, a dead end). HOD and WFM can
also send a requirement back one stage instead of approving it (HOD ->
`SUBMITTED`, WFM -> `HOD_REVIEW`) when it needs rework; the Leader stage has
no send-back target, since `SUBMITTED` is already the first reviewable stage.

A requirement is created in status `SUBMITTED` - there is no separate
`LEADER_REVIEW` status, because a freshly-submitted requirement already *is*
the "awaiting Leader" state. `backend/src/modules/roster/roster.service.ts`'s
`TRANSITIONS` map is keyed by the status a rule applies to (`SUBMITTED`,
`HOD_REVIEW`, `WFM_REVIEW`), each naming the permission required
(`roster.review.leader`/`.hod`/`.wfm`) and the decisions valid from that
status:

| Status | Approve -> | Reject -> | Send back -> | Permission |
|---|---|---|---|---|
| `SUBMITTED` | `HOD_REVIEW` | `REJECTED` | *(nowhere earlier)* | `roster.review.leader` |
| `HOD_REVIEW` | `WFM_REVIEW` | `REJECTED` | `SUBMITTED` | `roster.review.hod` |
| `WFM_REVIEW` | `PUBLISHED` (see below) | `REJECTED` | `HOD_REVIEW` | `roster.review.wfm` |

Every decision is enforced twice: the route requires `roster.view` at minimum
(router-level middleware), then `reviewRequirement()` itself checks the
caller's full permission set against the rule for the requirement's *current*
status - a Leader and a WFM user call the identical
`POST /requirements/:id/review` endpoint, and the service decides which
permission that specific call needed. This is different from every other
module so far, where one route needs exactly one fixed permission - a
workflow needs the check to move with the entity's state.

### Why WFM's approval also publishes

WFM's `APPROVE` on a `WFM_REVIEW` requirement does two things in one
transaction: sets `Status = 'PUBLISHED'` *and* calls
`publishRequirement()`, which turns every row in
`RosterRequirementAssignment` into a live `PublishedRoster` slot. This is a
deliberate scope decision, not an oversight: the build spec's approval chain
ends with WFM approval, and nothing in sections 10-13 describes a distinct
"publish" click after that approval. Adding one would be a UI step with no
corresponding state the spec asks for. If a real deployment needs publication
to be a separate, later action (e.g. to publish many approved requirements
at once on a fixed schedule), that is a product decision to make with real
usage feedback, not something to guess at now.

## Data model (`database/migrations/0007_roster_workflow.sql`)

| Table | Purpose |
|---|---|
| `RosterRequirement` | One row per submitted headcount requirement (date, location/process/department/shift, required HC, status) |
| `RosterRequirementAction` | Full audit trail of every submit/approve/reject/send-back, with comments and who/when - independent of `audit.AuditLog`, because this is the workflow's own domain history, browsable without audit-log permissions |
| `RosterRequirementAssignment` | Which employees the Leader (or HOD) proposes to fill the requirement with - editable during review, turned into `PublishedRoster` rows on publish |
| `PublishedRoster` | The official roster: one *active* row per employee/business date, enforced by a filtered unique index (`UX_PublishedRoster_ActiveSlot`, `WHERE IsActive = 1`) - the same "exactly one active version" discipline as `config.ConfigurationSetting`. Publishing again deactivates the previous row rather than overwriting it, so history is never lost |
| `RosterChange` | One row per confirmed shift/weekly-off change outside the requirement workflow, linking the previous and new `PublishedRoster` row and the reason given |

## The Change Impact Simulator

`roster.repository.ts`'s `simulateShiftChangeImpact(employeeId, businessDate,
newShiftId)` is read-only - it never writes anything. It answers "if I moved
this employee to this shift on this date, what would coverage look like
before and after, on both the old and new shift?":

```ts
{ oldShift: ShiftImpact | null; newShift: ShiftImpact }
// ShiftImpact = { shiftId, shiftCode, beforeHc, afterHc, requiredHc, gap }
```

`requiredHc` comes from the most recent `RosterRequirement` for that
date/shift in status `WFM_REVIEW` or `PUBLISHED` - if none exists, `requiredHc`
and `gap` are `null` rather than a fabricated number. The Roster Changes
screen (`/roster/changes`) calls this before showing a "Confirm change"
button, and refuses to submit if the form changed since the last preview (the
preview and the confirm must agree on employee/date/shift).

## Screens

| Screen | Path | Permission | What it does |
|---|---|---|---|
| Requirements | `/roster/requirements` | `roster.submit` to create, `roster.view` to list | Submit a new requirement, see all requirements paginated |
| Review | `/roster/review` | `roster.review.{leader,hod,wfm}` (server-decided) | The actionable queue: everything in `SUBMITTED`/`HOD_REVIEW`/`WFM_REVIEW`, with assign/approve/send-back/reject |
| Approvals | `/roster/approvals` | `roster.view` | Read-only master-detail: filter by status, select a requirement to see its full assignment list and decision timeline |
| Published Roster | `/roster/published` | `roster.view` | The active `PublishedRoster` rows for a date range |
| Roster Changes | `/roster/changes` | `roster.change` | Preview + confirm a shift change, and the history of past changes |

The "Approvals" screen's nav description mentions SLAs (build spec language);
today it shows each decision's real timestamp from `RosterRequirementAction`
(so elapsed time between stages is visible, not hidden), but no SLA
breach/compliance judgment - there is no configured SLA threshold anywhere
yet to compare against, and inventing one would be exactly the kind of
fabricated KPI the build spec prohibits. A real SLA view (configurable
threshold, breach highlighting) is a Phase 7 (Configuration Center) or Phase 9
(Exceptions) concern once there's a versioned setting to drive it.

## What's still a stub

The unified `/roster/calendar` view (roster + attendance + holidays +
forecast + staffing + exceptions in one calendar) is Phase 8 (Control Tower),
per `navTree.ts` - it needs modules this phase doesn't build yet.
