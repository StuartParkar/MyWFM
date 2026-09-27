import { execSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../../src/db/migrate.js";
import { closePool, getPool, sql } from "../../src/db/pool.js";
import { addAssignment, createRequirement, publishRequirement } from "../../src/modules/roster/roster.repository.js";

/**
 * Real-SQL-Server integration tests - see documentation/testing.md and
 * vitest.integration.config.ts. This is genuinely new coverage for this
 * project: the original build sandbox had no reachable SQL Server, so none of
 * this - the migration runner, the schema it produces, or any repository
 * function - had ever been exercised against a real database before.
 */

let testUserId: string;
const employeeIds: string[] = [];

beforeAll(async () => {
  const pool = await getPool();

  const userResult = await pool
    .request()
    .input("Email", sql.NVarChar(256), `phase12-integration-${Date.now()}@example.com`)
    .input("PasswordHash", sql.NVarChar(200), "not-a-real-hash")
    .input("DisplayName", sql.NVarChar(200), "Phase 12 Integration Test Fixture")
    .query<{ UserId: string }>(`
      INSERT INTO security.[User] (Email, PasswordHash, DisplayName)
      OUTPUT INSERTED.UserId
      VALUES (@Email, @PasswordHash, @DisplayName)
    `);
  testUserId = userResult.recordset[0]!.UserId;

  for (const suffix of ["A", "B"]) {
    const empResult = await pool
      .request()
      .input("EmployeeCode", sql.VarChar(20), `P12-${Date.now()}-${suffix}`)
      .input("FullName", sql.NVarChar(200), `Phase 12 Fixture Employee ${suffix}`)
      .query<{ EmployeeId: string }>(`
        INSERT INTO [master].Employee (EmployeeCode, FullName)
        OUTPUT INSERTED.EmployeeId
        VALUES (@EmployeeCode, @FullName)
      `);
    employeeIds.push(empResult.recordset[0]!.EmployeeId);
  }
});

afterAll(async () => {
  const pool = await getPool();
  await pool
    .request()
    .input("UserId", sql.UniqueIdentifier, testUserId)
    .query(`DELETE FROM [roster].PublishedRoster WHERE PublishedByUserId = @UserId`);
  for (const employeeId of employeeIds) {
    await pool.request().input("EmployeeId", sql.UniqueIdentifier, employeeId).query(`
      DELETE FROM [roster].RosterRequirementAssignment WHERE EmployeeId = @EmployeeId;
      DELETE FROM [master].Employee WHERE EmployeeId = @EmployeeId;
    `);
  }
  await pool.request().input("UserId", sql.UniqueIdentifier, testUserId).query(`
    DELETE FROM [roster].RosterRequirement WHERE RequestedByUserId = @UserId;
    DELETE FROM security.[User] WHERE UserId = @UserId;
  `);
  await closePool();
});

describe("migration runner against a real SQL Server", () => {
  it("is idempotent: applying migrations twice applies nothing the second time", async () => {
    await applyMigrations(`test:${Date.now()}`);
    const second = await applyMigrations(`test:${Date.now()}`);
    expect(second.applied).toEqual([]);
  });
});

describe("db:seed against a real SQL Server", () => {
  it("is idempotent: running the real `npm run db:seed` twice both succeed", () => {
    const backendRoot = path.resolve(import.meta.dirname, "../..");
    const run = () => execSync("npm run db:seed", { cwd: backendRoot, stdio: "pipe" });
    expect(run).not.toThrow();
    expect(run).not.toThrow();
  });
});

describe("roster.publishRequirement against a real SQL Server", () => {
  it("batch-publishes every assignment in one call and increments the version on republish", async () => {
    const requirementId = await createRequirement({
      businessDate: "2026-12-01",
      requiredHc: employeeIds.length,
      requestedByUserId: testUserId,
    });
    for (const employeeId of employeeIds) {
      await addAssignment(requirementId, employeeId, testUserId);
    }

    const firstCount = await publishRequirement(requirementId, testUserId);
    expect(firstCount).toBe(employeeIds.length);

    const pool = await getPool();
    const afterFirst = await pool
      .request()
      .input("RequirementId", sql.BigInt, requirementId)
      .query<{ EmployeeId: string; Version: number; IsActive: boolean }>(`
        SELECT EmployeeId, Version, IsActive FROM [roster].PublishedRoster WHERE RosterRequirementId = @RequirementId
      `);
    expect(afterFirst.recordset).toHaveLength(employeeIds.length);
    expect(afterFirst.recordset.every((r) => r.Version === 1 && r.IsActive)).toBe(true);

    const secondCount = await publishRequirement(requirementId, testUserId);
    expect(secondCount).toBe(employeeIds.length);

    const afterSecond = await pool
      .request()
      .input("RequirementId", sql.BigInt, requirementId)
      .query<{ EmployeeId: string; Version: number; IsActive: boolean }>(`
        SELECT EmployeeId, Version, IsActive FROM [roster].PublishedRoster WHERE RosterRequirementId = @RequirementId ORDER BY Version
      `);
    // 2 employees x 2 publishes = 4 rows total: the first version now inactive, the second active.
    expect(afterSecond.recordset).toHaveLength(employeeIds.length * 2);
    const active = afterSecond.recordset.filter((r) => r.IsActive);
    const inactive = afterSecond.recordset.filter((r) => !r.IsActive);
    expect(active).toHaveLength(employeeIds.length);
    expect(inactive).toHaveLength(employeeIds.length);
    expect(active.every((r) => r.Version === 2)).toBe(true);
    expect(inactive.every((r) => r.Version === 1)).toBe(true);
  });
});
