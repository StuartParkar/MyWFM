# Table Reference Mirror

Empty for now, by choice. See `database/schema/README.md` ("Migrations vs.
programmability objects") - with 8 tables total in Phase 1, the numbered files
under `database/migrations/` are already the fastest way to read current table
shape. This folder starts getting one `.sql` file per table (a plain
`CREATE TABLE` mirror of current state, not executed by the runner) once the
schema grows large enough that scanning migration history stops being the
quickest way to answer "what does this table look like today."
