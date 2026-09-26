# Seed Data

## Real reference data (this folder, numbered `.sql` files)

`0001_roles_and_permissions.sql` and `0002_default_configuration.sql` are
**not** demo data - they are required rows the application cannot function
without in any environment (dev, staging, production). Applied by
`npm run db:seed` (see `backend/src/db/seed.ts`), safe to re-run.

## Demo data (local development only)

The one thing this folder deliberately does **not** contain is a demo admin
login. Creating that requires bcrypt-hashing a password, which is an
application-layer concern, not something T-SQL should do (embedding a
hand-computed hash in a `.sql` file risks silently drifting from the app's
actual hashing parameters). Instead:

- **Production bootstrap**: `npm run create-admin --workspace=backend` (see
  `backend/src/scripts/createAdmin.ts`) prompts for a real email/password and
  inserts one ADMIN user using the same `hashPassword()` the login flow
  verifies against.
- **Local dev convenience**: `npm run db:seed:dev --workspace=backend` (see
  `backend/src/scripts/seedDev.ts`) creates `admin@example.com` with a
  well-known password, logged clearly as `DEMO DATA` in the console output.
  Refuses to run when `NODE_ENV=production`.

Never mix the two: the dev seed script's whole purpose is to be an obviously
fake, throwaway login that cannot be mistaken for a real credential.
