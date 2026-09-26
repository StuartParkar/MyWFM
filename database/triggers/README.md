# Triggers

Deliberately empty, and expected to stay small. Business audit trails
(build spec section 44: who/what/when/where/before/after/reason/reference) are
written explicitly by application services (see `backend/src/modules/audit`)
rather than by `AFTER INSERT/UPDATE` triggers, because the audit log needs
request-level context - the acting user, their reason text, the correlation id
- that a trigger cannot see. Triggers are reserved for invariants the database
itself must enforce regardless of caller (none identified yet); add one here
only when a specific integrity rule can't be expressed as a constraint.
