# Functions

Empty for now. Scalar/table-valued functions arrive with the Business Day
Engine (Phase 5) and the deterministic Calculation Engine (Phase 7), which are
the first subsystems with real per-row formula logic worth pushing into SQL.
Written as `CREATE OR ALTER FUNCTION` and re-applied on every deploy by the
migration runner's programmability phase (see `database/schema/README.md`).
