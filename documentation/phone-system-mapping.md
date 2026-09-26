# Phone System Mapping

Build spec section 76 is explicit: do not invent phone-system columns. This
document stays a stub - for the *mapping* only - until real sample files from
the three phone systems are provided, inspected, and mapped one at a time
(columns, grain, identifiers, date/time format, timezone, queue/agent fields,
offered/answered/abandoned, talk/hold/ACW, duplicates, source-specific
differences), each producing a versioned mapping (`CALLSYSTEM1-V1`, etc. -
section 59).

The *universal* call structure section 16 gives verbatim - independent of any
specific source file - already exists: `calls.QueueIntervalCall` and
`calls.AgentIntervalCall` (migration `0009_calls.sql`) and a read-only API
(`documentation/api.md`). Both tables are empty by design. Phase 6 paused
there (backend only, no frontend screen or tests yet) at the point real
phone-system sample files were about to be provided - see
`documentation/database.md` for what exists; this document specifically
covers the not-yet-built part, the source-specific mapping. When the first
phone-system file arrives, it belongs in
`imports/samples/<system-name>/`, alongside a README following the same
provenance/observations format as `imports/samples/master-data/README.md`.
