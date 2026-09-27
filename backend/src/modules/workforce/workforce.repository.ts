import { getPool, sql } from "../../db/pool.js";

export interface WorkforcePlanInput {
  businessMonth: string;
  departmentId: number | null;
  processId: number | null;
  locationId: number | null;
  designationId: number | null;
  requiredHC: number;
  plannedHiresHC: number;
  plannedExitsHC: number;
  notes: string | null;
  createdByUserId: string;
}

/**
 * Same versioning discipline as roster.PublishedRoster (roster.repository.ts's
 * publishRequirement): look up the current active row for this exact key, deactivate it, then
 * insert a new row at Version+1 - never an UPDATE in place, so a plan's history (who set what
 * target, when) is never lost. The key is the four dimensions' sentinel (-1 for "not broken
 * down by this one") columns, matching UX_WorkforcePlan_ActiveKey exactly.
 */
export async function createOrReplacePlan(input: WorkforcePlanInput): Promise<number> {
  const pool = await getPool();
  const departmentKey = input.departmentId ?? -1;
  const processKey = input.processId ?? -1;
  const locationKey = input.locationId ?? -1;
  const designationKey = input.designationId ?? -1;

  const previous = await pool
    .request()
    .input("BusinessMonth", sql.Date, input.businessMonth)
    .input("DepartmentKey", sql.Int, departmentKey)
    .input("ProcessKey", sql.Int, processKey)
    .input("LocationKey", sql.Int, locationKey)
    .input("DesignationKey", sql.Int, designationKey)
    .query<{ WorkforcePlanId: number; Version: number }>(`
      SELECT WorkforcePlanId, Version FROM [workforce].WorkforcePlan
      WHERE BusinessMonth = @BusinessMonth AND DepartmentKey = @DepartmentKey AND ProcessKey = @ProcessKey
        AND LocationKey = @LocationKey AND DesignationKey = @DesignationKey AND IsActive = 1
    `);
  const previousRow = previous.recordset[0];

  if (previousRow) {
    await pool.request().input("Id", sql.Int, previousRow.WorkforcePlanId).query(`UPDATE [workforce].WorkforcePlan SET IsActive = 0 WHERE WorkforcePlanId = @Id`);
  }

  const result = await pool
    .request()
    .input("BusinessMonth", sql.Date, input.businessMonth)
    .input("DepartmentId", sql.Int, input.departmentId)
    .input("ProcessId", sql.Int, input.processId)
    .input("LocationId", sql.Int, input.locationId)
    .input("DesignationId", sql.Int, input.designationId)
    .input("RequiredHC", sql.Int, input.requiredHC)
    .input("PlannedHiresHC", sql.Int, input.plannedHiresHC)
    .input("PlannedExitsHC", sql.Int, input.plannedExitsHC)
    .input("Notes", sql.NVarChar(500), input.notes)
    .input("Version", sql.Int, (previousRow?.Version ?? 0) + 1)
    .input("CreatedByUserId", sql.UniqueIdentifier, input.createdByUserId)
    .query<{ WorkforcePlanId: number }>(`
      INSERT INTO [workforce].WorkforcePlan (BusinessMonth, DepartmentId, ProcessId, LocationId, DesignationId, RequiredHC, PlannedHiresHC, PlannedExitsHC, Notes, Version, CreatedByUserId)
      OUTPUT INSERTED.WorkforcePlanId
      VALUES (@BusinessMonth, @DepartmentId, @ProcessId, @LocationId, @DesignationId, @RequiredHC, @PlannedHiresHC, @PlannedExitsHC, @Notes, @Version, @CreatedByUserId)
    `);
  return result.recordset[0]!.WorkforcePlanId;
}

export interface WorkforcePlanRow {
  workforcePlanId: number;
  businessMonth: string;
  departmentId: number | null;
  departmentName: string | null;
  processId: number | null;
  processName: string | null;
  locationId: number | null;
  locationName: string | null;
  designationId: number | null;
  designationName: string | null;
  requiredHC: number;
  plannedHiresHC: number;
  plannedExitsHC: number;
  notes: string | null;
  version: number;
  createdByName: string;
  createdAt: string;
}

export async function listPlans(params: { from?: string; to?: string; departmentId?: number; processId?: number; locationId?: number; designationId?: number }): Promise<WorkforcePlanRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("From", sql.Date, params.from ?? null)
    .input("To", sql.Date, params.to ?? null)
    .input("DepartmentId", sql.Int, params.departmentId ?? null)
    .input("ProcessId", sql.Int, params.processId ?? null)
    .input("LocationId", sql.Int, params.locationId ?? null)
    .input("DesignationId", sql.Int, params.designationId ?? null)
    .query<{
      WorkforcePlanId: number;
      BusinessMonth: string;
      DepartmentId: number | null;
      DepartmentName: string | null;
      ProcessId: number | null;
      ProcessName: string | null;
      LocationId: number | null;
      LocationName: string | null;
      DesignationId: number | null;
      DesignationName: string | null;
      RequiredHC: number;
      PlannedHiresHC: number;
      PlannedExitsHC: number;
      Notes: string | null;
      Version: number;
      CreatedByName: string;
      CreatedAt: Date;
    }>(`
      SELECT
        p.WorkforcePlanId, CONVERT(VARCHAR(10), p.BusinessMonth, 23) AS BusinessMonth,
        p.DepartmentId, dept.DepartmentName, p.ProcessId, mp.ProcessName, p.LocationId, loc.LocationName, p.DesignationId, des.DesignationName,
        p.RequiredHC, p.PlannedHiresHC, p.PlannedExitsHC, p.Notes, p.Version,
        u.DisplayName AS CreatedByName, p.CreatedAt
      FROM [workforce].WorkforcePlan p
      LEFT JOIN [master].Department dept ON dept.DepartmentId = p.DepartmentId
      -- "proc" is rejected by SQL Server as a table alias (Incorrect syntax
      -- near the keyword 'proc') - found by running this against a real server.
      LEFT JOIN [master].Process mp ON mp.ProcessId = p.ProcessId
      LEFT JOIN [master].Location loc ON loc.LocationId = p.LocationId
      LEFT JOIN [master].Designation des ON des.DesignationId = p.DesignationId
      JOIN security.[User] u ON u.UserId = p.CreatedByUserId
      WHERE p.IsActive = 1
        AND (@From IS NULL OR p.BusinessMonth >= @From)
        AND (@To IS NULL OR p.BusinessMonth <= @To)
        AND (@DepartmentId IS NULL OR p.DepartmentId = @DepartmentId)
        AND (@ProcessId IS NULL OR p.ProcessId = @ProcessId)
        AND (@LocationId IS NULL OR p.LocationId = @LocationId)
        AND (@DesignationId IS NULL OR p.DesignationId = @DesignationId)
      ORDER BY p.BusinessMonth, dept.DepartmentName, mp.ProcessName, loc.LocationName, des.DesignationName
    `);
  return result.recordset.map((r) => ({
    workforcePlanId: r.WorkforcePlanId,
    businessMonth: r.BusinessMonth,
    departmentId: r.DepartmentId,
    departmentName: r.DepartmentName,
    processId: r.ProcessId,
    processName: r.ProcessName,
    locationId: r.LocationId,
    locationName: r.LocationName,
    designationId: r.DesignationId,
    designationName: r.DesignationName,
    requiredHC: r.RequiredHC,
    plannedHiresHC: r.PlannedHiresHC,
    plannedExitsHC: r.PlannedExitsHC,
    notes: r.Notes,
    version: r.Version,
    createdByName: r.CreatedByName,
    createdAt: r.CreatedAt.toISOString(),
  }));
}

/**
 * Real, current headcount matching whichever dimensions are given (NULL = don't filter by that
 * one) - Department/Location/Designation are direct master.Employee columns; Process is
 * master.EmployeeProcess.IsPrimary = 1 (an employee's one "home" process), not derived from a
 * roster assignment - that table has existed, populated by the org-hierarchy import, since
 * Phase 2, but nothing before this read it (Roster/Staffing/Control Tower/Intraday all
 * attribute process via a published requirement instead, a different and equally real
 * relationship - see documentation/workforce.md for why Current HC needs this one instead).
 */
export async function getCurrentHC(params: { departmentId: number | null; processId: number | null; locationId: number | null; designationId: number | null }): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("DepartmentId", sql.Int, params.departmentId)
    .input("ProcessId", sql.Int, params.processId)
    .input("LocationId", sql.Int, params.locationId)
    .input("DesignationId", sql.Int, params.designationId)
    .query<{ Cnt: number }>(`
      SELECT COUNT(DISTINCT e.EmployeeId) AS Cnt
      FROM [master].Employee e
      LEFT JOIN [master].EmployeeProcess ep ON ep.EmployeeId = e.EmployeeId AND ep.IsPrimary = 1
      WHERE e.IsActive = 1
        AND (@DepartmentId IS NULL OR e.DepartmentId = @DepartmentId)
        AND (@LocationId IS NULL OR e.LocationId = @LocationId)
        AND (@DesignationId IS NULL OR e.DesignationId = @DesignationId)
        AND (@ProcessId IS NULL OR ep.ProcessId = @ProcessId)
    `);
  return result.recordset[0]?.Cnt ?? 0;
}

// ---------------------------------------------------------------------------
// Scenario Planning
// ---------------------------------------------------------------------------

export interface ScenarioInput {
  scenarioName: string;
  processId: number | null;
  baselineFrom: string;
  baselineTo: string;
  volumeChangePct: number;
  ahtChangePct: number;
  shrinkagePctOverride: number | null;
  hcChange: number;
  notes: string | null;
}

export async function createScenario(input: ScenarioInput & { createdByUserId: string }): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("ScenarioName", sql.NVarChar(200), input.scenarioName)
    .input("ProcessId", sql.Int, input.processId)
    .input("BaselineFrom", sql.Date, input.baselineFrom)
    .input("BaselineTo", sql.Date, input.baselineTo)
    .input("VolumeChangePct", sql.Decimal(6, 2), input.volumeChangePct)
    .input("AhtChangePct", sql.Decimal(6, 2), input.ahtChangePct)
    .input("ShrinkagePctOverride", sql.Decimal(6, 2), input.shrinkagePctOverride)
    .input("HcChange", sql.Int, input.hcChange)
    .input("Notes", sql.NVarChar(500), input.notes)
    .input("CreatedByUserId", sql.UniqueIdentifier, input.createdByUserId)
    .query<{ ScenarioId: number }>(`
      INSERT INTO [workforce].Scenario (ScenarioName, ProcessId, BaselineFrom, BaselineTo, VolumeChangePct, AhtChangePct, ShrinkagePctOverride, HcChange, Notes, CreatedByUserId)
      OUTPUT INSERTED.ScenarioId
      VALUES (@ScenarioName, @ProcessId, @BaselineFrom, @BaselineTo, @VolumeChangePct, @AhtChangePct, @ShrinkagePctOverride, @HcChange, @Notes, @CreatedByUserId)
    `);
  return result.recordset[0]!.ScenarioId;
}

export interface ScenarioRow extends ScenarioInput {
  scenarioId: number;
  processName: string | null;
  createdByName: string;
  createdAt: string;
  modifiedAt: string;
}

const SCENARIO_SELECT = `
  SELECT s.ScenarioId, s.ScenarioName, s.ProcessId, mp.ProcessName,
         CONVERT(VARCHAR(10), s.BaselineFrom, 23) AS BaselineFrom, CONVERT(VARCHAR(10), s.BaselineTo, 23) AS BaselineTo,
         s.VolumeChangePct, s.AhtChangePct, s.ShrinkagePctOverride, s.HcChange, s.Notes,
         u.DisplayName AS CreatedByName, s.CreatedAt, s.ModifiedAt
  FROM [workforce].Scenario s
  -- "proc" is rejected by SQL Server as a table alias - see the same fix in
  -- listWorkforcePlans above.
  LEFT JOIN [master].Process mp ON mp.ProcessId = s.ProcessId
  JOIN security.[User] u ON u.UserId = s.CreatedByUserId
`;

function mapScenarioRow(r: {
  ScenarioId: number;
  ScenarioName: string;
  ProcessId: number | null;
  ProcessName: string | null;
  BaselineFrom: string;
  BaselineTo: string;
  VolumeChangePct: number;
  AhtChangePct: number;
  ShrinkagePctOverride: number | null;
  HcChange: number;
  Notes: string | null;
  CreatedByName: string;
  CreatedAt: Date;
  ModifiedAt: Date;
}): ScenarioRow {
  return {
    scenarioId: r.ScenarioId,
    scenarioName: r.ScenarioName,
    processId: r.ProcessId,
    processName: r.ProcessName,
    baselineFrom: r.BaselineFrom,
    baselineTo: r.BaselineTo,
    volumeChangePct: r.VolumeChangePct,
    ahtChangePct: r.AhtChangePct,
    shrinkagePctOverride: r.ShrinkagePctOverride,
    hcChange: r.HcChange,
    notes: r.Notes,
    createdByName: r.CreatedByName,
    createdAt: r.CreatedAt.toISOString(),
    modifiedAt: r.ModifiedAt.toISOString(),
  };
}

export async function listScenarios(): Promise<ScenarioRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`${SCENARIO_SELECT} ORDER BY s.ModifiedAt DESC`);
  return result.recordset.map(mapScenarioRow);
}

export async function getScenario(id: number): Promise<ScenarioRow | null> {
  const pool = await getPool();
  const result = await pool.request().input("Id", sql.Int, id).query(`${SCENARIO_SELECT} WHERE s.ScenarioId = @Id`);
  const row = result.recordset[0];
  return row ? mapScenarioRow(row) : null;
}

export async function updateScenario(id: number, input: ScenarioInput): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("Id", sql.Int, id)
    .input("ScenarioName", sql.NVarChar(200), input.scenarioName)
    .input("ProcessId", sql.Int, input.processId)
    .input("BaselineFrom", sql.Date, input.baselineFrom)
    .input("BaselineTo", sql.Date, input.baselineTo)
    .input("VolumeChangePct", sql.Decimal(6, 2), input.volumeChangePct)
    .input("AhtChangePct", sql.Decimal(6, 2), input.ahtChangePct)
    .input("ShrinkagePctOverride", sql.Decimal(6, 2), input.shrinkagePctOverride)
    .input("HcChange", sql.Int, input.hcChange)
    .input("Notes", sql.NVarChar(500), input.notes)
    .query(`
      UPDATE [workforce].Scenario
      SET ScenarioName = @ScenarioName, ProcessId = @ProcessId, BaselineFrom = @BaselineFrom, BaselineTo = @BaselineTo,
          VolumeChangePct = @VolumeChangePct, AhtChangePct = @AhtChangePct, ShrinkagePctOverride = @ShrinkagePctOverride,
          HcChange = @HcChange, Notes = @Notes, ModifiedAt = SYSUTCDATETIME()
      WHERE ScenarioId = @Id
    `);
}

export async function deleteScenario(id: number): Promise<void> {
  const pool = await getPool();
  await pool.request().input("Id", sql.Int, id).query(`DELETE FROM [workforce].Scenario WHERE ScenarioId = @Id`);
}
