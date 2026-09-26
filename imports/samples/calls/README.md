# Calls Samples

This folder holds **real** phone-system call-detail exports (extracted subsets, not
synthetic), used to design and validate the Phase 6 universal calls model and its four
importers. Per build spec section 76 ("never invent phone-system column mappings"), every
mapping decision below was derived by inspecting these files directly, not assumed in
advance.

## Provenance

Two files were provided by stuart@absoluteholidays.com via chat on 2026-09-26:

1. **`Calls.xlsx`** (23.1 MB) - one workbook, five sheets:
   - `Vonage QueueWise` (32,026 data rows)
   - `Vonage - Company Summary` (83,855 data rows)
   - `Elevate` (59,414 data rows)
   - `RingCentral` (12,534 data rows)
   - `RingCentral - AgentWise` (50 data rows)
2. **`Sample.xlsx`** (756.8 KB), labeled by the user "Agent Wise RingCentral Sample" -
   provided specifically after the first file's `RingCentral` sheet turned out not to carry
   clean per-agent columns (see "RingCentral: two sheets, one mapped" below) - one sheet:
   - `Calls` (10,511 data rows)

Real company name confirmed directly in the data (`Vonage - Company Summary`'s `Location`
column: `Absolute Holidays LLC`) - this is genuine operational data, not a vendor demo
export.

The four `*-sample.xlsx` files in this folder are a real-row subset (400-406 rows each) of
the four sheets that were actually mapped and implemented (`Vonage QueueWise`,
`Vonage - Company Summary`, `Elevate`, and file 2's `Calls`), kept small enough to commit
and use as test fixtures while preserving the edge cases documented below (mixed cell
types, unanswered/voicemail/IVR dispositions, unresolved agent names). They are not the
full originals - do not treat row counts here as production volume.

## Timezone (confirmed by the user, not inferred)

Each source's timestamps are naive (no offset recorded in the file). Per the user:

| Source | Timezone |
|---|---|
| Elevate | `America/Los_Angeles` (Pacific) |
| Vonage (both sheets) | `America/New_York` (Eastern) |
| RingCentral | `America/New_York` (Eastern) |

## RingCentral: two sheets, one mapped

`Calls.xlsx`'s `RingCentral` sheet and `RingCentral - AgentWise` sheet were both inspected
and are **not** implemented in this phase:

- `RingCentral - AgentWise` is a pre-aggregated per-agent KPI rollup (`Total Calls`,
  `Avg. Handle Time`, `% Answered (in)`, ...) - the wrong grain entirely for a call-detail
  fact table; importing it would mean storing someone else's aggregate as if it were a raw
  fact, which the calculation-ledger design (Phase 7) specifically exists to avoid.
- `RingCentral` is genuine call-detail, but a structurally different and more complex
  export than the other three sources: it appears to emit **more than one row per call**
  (e.g. two consecutive rows sharing the same `From`, `Date`, `Time` and `Duration` but
  with different `Type`/`Extension`/`To` values - consistent with one row per call "leg" or
  perspective, not one row per call), its `Name` column is the *external* caller's name
  (not an internal agent), and its own disposition vocabulary (`Action Result`: `Missed`,
  `Accepted`, ...) is different from file 2's `Calls` sheet. Mapping this correctly needs
  its own inspection pass and is left for a future phase rather than guessed at now.

`Sample.xlsx`'s `Calls` sheet - the file the user provided specifically in response to an
agent-wise RingCentral question - is a clean one-row-per-call export with usable
`From Name`/`To Name` columns, and is what the `ringcentral-calls` importer actually reads.

## Column mapping to the target schema

Both target tables (`calls.QueueIntervalCall`, `calls.AgentIntervalCall` - migrations
`0009_calls.sql` and `0011_calls_call_detail.sql`) share this shape: `BusinessDate`,
`IntervalStart`/`IntervalEnd` (UTC instants), `Timezone`, `SourceCallId`, `Direction`,
`WaitSeconds`/`TalkSeconds`/`HoldSeconds`/`AcwSeconds`/`HandleSeconds`, `Disposition`, plus
either a queue identity (`QueueId`/`SourceQueueId`/queue name) or an agent identity
(`AgentId`/`SourceAgentId`/agent name), or both.

### `Vonage QueueWise` -> `calls.QueueIntervalCall` only

One row per call into a queue. `Agent` is populated only when the call reached someone -
still recorded as a queue-grain fact (this is a queue-focused export, not a separate
pre-aggregated agent record).

| Source column | Meaning | Mapping |
|---|---|---|
| `Call ID` | Vonage's own call UUID | `SourceCallId` |
| `Call Queue` | Queue display name, e.g. `English - Queue 1 (U) - 515` | `QueueName`/`SourceQueueId` (upserted into `master.Queue`) |
| `Date/Time` | Call start, naive local time | Combined with `Timezone` -> `IntervalStart` |
| `Agent` | Answering agent's alias + optional team-code suffix, e.g. `Frank TOT` | Resolved via the alias cascade -> `AgentId`/`AgentName`; unresolved -> `UNRESOLVED_CALL_PARTICIPANT` (kept, `AgentId` null) |
| `Answered Date/Time` | Answer timestamp, or the literal string `Not Answered` | When present: `IntervalEnd` = this + `Talk Time`. When `Not Answered` (fails to parse as a timestamp by design): `IntervalEnd` = `IntervalStart` + `Wait Time` |
| `Disposition` | `answered` / `abandoned` / `forwarded` / `voicemail` | Upper-cased into `Disposition`; anything else -> `OTHER` + LOW-severity `UNRECOGNIZED_DISPOSITION` issue |
| `Talk Time` | Excel time-of-day cell (1899-12-30 epoch) | -> `TalkSeconds` |
| `Wait Time` | Excel time-of-day cell | -> `WaitSeconds` |
| `Extension`, `From` | Internal extension, caller ANI | Not currently mapped (no target column needs them yet) |

### `Vonage - Company Summary` -> `calls.AgentIntervalCall` only

The company-wide multi-leg call log. Per the user, this is the agent-grain source for
Vonage (`Source UserId`/`Destination UserId` identify the agent directly, which
`QueueWise` does not for every row). A row with **no** agent on either side is a pure
queue leg already covered by `QueueWise` - skipped here, not fabricated into an agent row.

| Source column | Meaning | Mapping |
|---|---|---|
| `Call ID` | Vonage's own call UUID | `SourceCallId` |
| `Direction` | `inbound` / `outbound` / `intrapbx` | -> `INBOUND`/`OUTBOUND`/`INTERNAL` |
| `Source UserId` / `Destination UserId` | Agent alias + suffix on whichever side is internal | Outbound: prefer `Source UserId`, fall back to `Destination UserId`. Inbound/intrapbx: prefer `Destination UserId`, fall back to `Source UserId`. Resolved via the same alias cascade |
| `Date/Time` | Call start - observed as a **string** cell in this sample (`MM/DD/YYYY H:MM:SS AM/PM`); other rows in the full original may come through as genuine Excel dates (`cellToWallClock` handles both) | -> `IntervalStart` |
| `Duration` | Excel time-of-day cell | -> `HandleSeconds`; `IntervalEnd` = `IntervalStart` + this |
| `Result` | `answered` / `missed` / `voicemail` / `blocked` / `attempted` | -> `Disposition` (`blocked`/`attempted` both map to `OTHER` - neither is a real talk/no-talk outcome) |

### `Elevate` -> both tables, conditionally, per row

A single CDR sheet with both a queue dimension (`Group`, literal `-` for ungrouped/direct
calls) and an agent dimension (`To Name`/`From Name`, but only meaningful when that side's
device type is `WebRTC` - an agent softphone - rather than `PSTN`/`IVR`/`Voicemail`). One
real call can legitimately produce a queue-grain row, an agent-grain row, both, or
**neither** (e.g. a call that only ever reached an IVR or voicemail, never a queue or an
agent) - confirmed directly in the sample (35 of 400 rows produce neither).

| Source column | Meaning | Mapping |
|---|---|---|
| `Call Identifier` | Elevate's own call UUID | `SourceCallId` |
| `Date` + `Start Time` | Date as an Excel date, time as a separate Excel time-of-day cell | Combined -> `IntervalStart` |
| `Total Call Duration (sec)` | Already a plain number in seconds (not a time-formatted cell, unlike the other three sources) | -> `IntervalEnd` = `IntervalStart` + this; also `HandleSeconds` when answered |
| `Direction` | `Inbound` / `Outbound` / `Internal` | -> `INBOUND`/`OUTBOUND`/`INTERNAL` |
| `Group` | Queue/campaign name, or `-` | When not `-`: queue-grain row emitted, `QueueName` = this value |
| `From Name`/`From Device Type`, `To Name`/`To Device Type` | Which side is outbound decides which pair is "the relevant side" (`From` for outbound, `To` otherwise) | When the relevant `Device Type` is `WebRTC` and the relevant `Name` is present: agent-grain row emitted, name resolved via the alias cascade |
| `Answered` | `Yes` / `No` | Drives `Disposition` (`ANSWERED` when yes; `VOICEMAIL` when the relevant device type is `Voicemail`; `OTHER` for `IVR`; else `MISSED`) |

### File 2's `Calls` (RingCentral, agent-wise sample) -> both tables, per row

One row per call. The internal party - `From Name` for an outbound call, `To Name`
otherwise - is sometimes a queue/team label (`Sales 3`, `Hotel Reservation Desk -
LEE JESSIE`) and sometimes an individual agent's alias (`Alvin BCA`, `Jake TOT`), with no
column flagging which. Resolved by trying the agent-alias match first; anything that
doesn't resolve is treated as a queue/team label, never guessed at further. Every row in
the sample produces exactly one output row (never both, never neither) - confirmed
directly (400 input rows -> 400 output rows split across both tables).

| Source column | Meaning | Mapping |
|---|---|---|
| `Session Id` | RingCentral's own call/session id | `SourceCallId` |
| `Call Start Time` | `M/D/YYYY H:MM:SS AM/PM` string (hour not always zero-padded, e.g. `9:54:55 PM`) | -> `IntervalStart` |
| `Call Length` | Excel time-of-day cell | `IntervalEnd` = `IntervalStart` + this |
| `Handle Time` | Excel time-of-day cell, sometimes blank (e.g. on an outbound `Connected` row with no answering party) | -> `HandleSeconds` (nullable) |
| `Call Direction` | `Outbound` / `Inbound` | -> `OUTBOUND`/`INBOUND` |
| `Result` | `Connected` / `Answered` / `Missed` / `VM/Missed` / `Not Connected` | -> `CONNECTED`/`ANSWERED`/`MISSED`/`VOICEMAIL`/`NOT_CONNECTED` |
| `From Name` / `To Name` | See above - classified by alias resolution, not by column position | Resolved side -> `AgentId`/`AgentName`/`SourceAgentId`; unresolved side -> `QueueName`/`SourceQueueId` |
| `Queue` | Confirmed queue label, present on some inbound rows (e.g. `Hotel Reservation Desk`) | Attached as `QueueName`/`SourceQueueId` alongside whichever grain the row lands in - does not by itself decide agent vs. queue |

## Agent alias resolution (shared across all four sources)

Real employees have single-word BPO "floor" aliases (`master.Employee.AliasName`, e.g.
Ritesh Kumar Thakur's alias is `Rocky`) with no relation to their legal name. Phone systems
append inconsistent team-code suffixes, either space-separated (`Frank TOT`, `Jake TOT`) or
concatenated (`ShawnTHD`, `lisaTHD`) - both forms, and mixed casing, were confirmed directly
in these files. Resolution tries, in order:

1. The raw value as-is (case-insensitive).
2. Its first token, split on whitespace or a dot (handles a `First.Last`-style value, not
   observed in these specific samples but supported since RingCentral's export format is
   not guaranteed consistent across accounts).
3. The raw value with a known suffix (`THD`, `TOT`, `STF`, `BCA`, `ICX` - every suffix
   actually observed across these files, not an authoritative or exhaustive list) stripped,
   case-insensitively.

Anything that still doesn't resolve - a genuine full name (`Troy Newman`, `Atticus Finch`),
or an alias not in the roster (`MOSSES`) - is kept as a data-quality flag
(`UNRESOLVED_CALL_PARTICIPANT`, MEDIUM severity) with the row retained and `AgentId` left
null, per the user's explicit instruction to flag rather than drop or guess. A queue/team
label (`Sales 3`, `Spanish Team DEL`) simply never matches and is correctly treated as a
queue identity instead, with no issue raised (it was never supposed to resolve).

## Data quality observations (real findings, informing the parser design)

1. **The same logical column comes through as either a genuine Excel date/time cell or a
   plain string, in the same column of the same file.** Confirmed directly (not a library
   artifact - checked with both `openpyxl`/`pandas` and `exceljs`, byte-identical
   conclusion): Vonage's `Date/Time` columns and Elevate's/RingCentral's date columns can be
   either. `cellToWallClock` handles both; the Excel `Date` branch reads wall-clock digits
   via UTC getters (exceljs represents a parsed date/time cell's components in UTC
   regardless of the workbook's own timezone).
2. **Excel TIME-of-day cells (Talk Time, Wait Time, Call Length, Handle Time) are `Date`
   objects on the 1899-12-30 epoch**, read via `getUTCHours/Minutes/Seconds` - except
   Elevate's duration columns, which are already plain numbers in seconds. Both are real,
   source-specific representations of "a duration," never assumed to be one or the other.
3. **Vonage's `Answered Date/Time` uses the literal string `"Not Answered"`** as its
   never-answered sentinel - not a blank cell, not a date. The US-datetime regex simply
   doesn't match it, which is what correctly routes those rows to the wait-time fallback for
   `IntervalEnd`.
4. **Elevate's `Group` and some `From Name`/`To Name` cells use a literal `"-"`** as their
   "no value" placeholder, exactly like the master-data hierarchy sheet's convention - not
   an empty cell.
5. **One real call can produce zero, one, or two output rows** (Elevate: queue-only,
   agent-only, both, or neither depending on `Group` and device type; the other three
   sources always produce at least one row, at most one per table). Grain tables are never
   summed together to "reconstruct" a missing row.
6. **Not every real "agent" value is a floor alias.** A meaningful minority of Vonage
   QueueWise's `Agent` values are full two-word legal names (`Troy Newman`, `Atticus Finch`,
   `Damian Greene`, `John White`, `Randall Green`) rather than the usual alias+suffix
   pattern. These are real, not test data, and correctly fall through to
   `UNRESOLVED_CALL_PARTICIPANT` today; resolving them would need a name-based lookup this
   phase deliberately does not add (the alias cascade only ever tries alias-shaped matches -
   see the parenthetical in the resolution list above about not guessing further).

None of the above required inventing a column or a mapping rule that wasn't directly
observed - where a source's real behavior was ambiguous (timezone, unresolved-name
handling), the user was asked directly (see `documentation/phone-system-mapping.md`) rather
than assumed.
