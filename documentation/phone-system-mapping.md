# Phone System Mapping

Build spec section 76 is explicit: do not invent phone-system columns. Real
sample files (call-detail exports, not pre-aggregated intervals) were
provided by stuart@absoluteholidays.com on 2026-09-26, inspected column by
column, and mapped into four source-specific parsers plus one shared
universal calls model. Nothing below was assumed before the corresponding
file was inspected.

## What's mapped

| Import source key | Sheet | Timezone | Produces |
|---|---|---|---|
| `vonage-queuewise` | `Vonage QueueWise` | `America/New_York` | Queue-grain only |
| `vonage-company-summary` | `Vonage - Company Summary` | `America/New_York` | Agent-grain only |
| `elevate` | `Elevate` | `America/Los_Angeles` | Queue-grain, agent-grain, both, or neither - per row |
| `ringcentral-calls` | `Calls` (from the "Agent Wise RingCentral Sample" file) | `America/New_York` | Queue-grain or agent-grain - per row |

Timezone was confirmed directly by the user (Elevate is Pacific; Vonage and
RingCentral are Eastern), not inferred - none of these files record an
offset.

The full column-by-column mapping, the real disposition/direction
vocabularies observed, the agent-alias resolution cascade (floor aliases
with inconsistent team-code suffixes, e.g. `Frank TOT`, `ShawnTHD`), and
every data-quality finding that shaped these decisions are documented in
`imports/samples/calls/README.md`, following the same provenance/observations
format as `imports/samples/master-data/README.md`. That file is the source
of truth for *why* each column maps the way it does; this page is only a
summary and an index.

**Explicitly not mapped in this phase** (inspected, not implemented - see
the calls README for why): `Calls.xlsx`'s own `RingCentral` sheet (a
structurally different, apparently multi-row-per-call export) and its
`RingCentral - AgentWise` sheet (pre-aggregated per-agent KPIs - the wrong
grain for a call-detail fact table).

## What exists

The universal call structure (section 16) - independent of any specific
source file - lives in `calls.QueueIntervalCall` and `calls.AgentIntervalCall`
(migrations `0009_calls.sql` and `0011_calls_call_detail.sql`, the latter
widening the schema for call-detail grain once the real files disproved the
original pre-aggregated-interval assumption), a read-only + import API (see
`documentation/api.md`), and an `operations/calls` frontend screen. See
`documentation/database.md` for the full schema and `documentation/imports.md`
for the import pipeline these four sources run through.
