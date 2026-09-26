// Runs before every test file. Provides just enough env to satisfy
// src/config/env.ts's eager validation (see that file for why it's eager) -
// none of these need to point at a real SQL Server for the unit tests in this
// suite, since none of them call getPool().connect().
process.env.NODE_ENV ??= "test";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.SQL_SERVER_HOST ??= "localhost";
process.env.SQL_SERVER_DATABASE ??= "UniversalMyWFM_Test";
process.env.SQL_SERVER_USER ??= "test";
process.env.SQL_SERVER_PASSWORD ??= "test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-please-ignore";
process.env.JWT_REFRESH_PEPPER ??= "test-refresh-pepper-please-ignore";
