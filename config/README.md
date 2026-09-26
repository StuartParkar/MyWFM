# Configuration

Universal MyWFM has two distinct configuration layers - do not blur them:

1. **Environment variables** (`.env`, deployment-time, requires a restart to
   change): connection strings, secrets, ports, CORS origin. See
   `backend/.env.example`, `frontend/.env.example` and root `.env.example`
   (for `docker-compose.yml`). Never committed, never versioned, never
   editable by an in-app screen.

2. **Application configuration** (`config.ConfigurationSetting`, runtime-editable,
   versioned, no restart required): business day timezone, service-level
   target, grace periods, shrinkage thresholds, and every other business rule
   listed in build spec section 54. Seeded with real defaults by
   `database/seed-data/0002_default_configuration.sql`, read through
   `backend/src/config/appConfig.ts`, and (from Phase 12 onward) editable
   through the Admin > Configuration screen rather than by hand.

This folder intentionally holds no config files of its own - if you're
looking for a business-rule default, it's in the database (layer 2), not
here. If you're looking for how to point the app at a different SQL Server or
change a secret, it's an environment variable (layer 1).
