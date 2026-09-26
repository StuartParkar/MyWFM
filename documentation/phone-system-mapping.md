# Phone System Mapping

Stub. Build spec section 76 is explicit: do not invent phone-system columns.
This document stays empty until real sample files from the three phone
systems are provided, inspected, and mapped one at a time (columns, grain,
identifiers, date/time format, timezone, queue/agent fields, offered/
answered/abandoned, talk/hold/ACW, duplicates, source-specific differences),
each producing a versioned mapping (`CALLSYSTEM1-V1`, etc. - section 59).

No universal call model, mapping, or normalization rule exists in code yet
(that's Phase 6). When the first phone-system file arrives, it belongs in
`imports/samples/<system-name>/`, alongside a README following the same
provenance/observations format as `imports/samples/master-data/README.md`.
