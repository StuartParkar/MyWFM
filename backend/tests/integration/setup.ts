// Loads backend/.env the same way `tsx --env-file=.env` does for the app
// itself (db:migrate, dev, etc.) - vitest isn't invoked through tsx, so this
// setup file is the equivalent for the integration suite. Tolerant of a
// missing .env: some environments (e.g. CI) set these as real process env
// vars instead of a file.
try {
  process.loadEnvFile();
} catch {
  // no .env file - assume the required vars are already in process.env
}
