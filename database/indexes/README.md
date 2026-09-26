# Supplemental Indexes

Structural indexes needed for primary/foreign/unique constraints are created
inline in `database/migrations/`. This folder is for **supplemental**
performance indexes added later in response to real query patterns (composite,
covering, filtered, columnstore, partition-aligned) - typically once fact
tables exist (calls, attendance) and dashboards/reports are actually querying
them (Phase 6+). Empty for now: there is no query workload yet to tune against,
and adding speculative indexes ahead of one would be guessing.
