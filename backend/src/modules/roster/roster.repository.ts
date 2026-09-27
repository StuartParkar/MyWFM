import type { PaginatedResult } from "@mywfm/shared";
import { getPool, sql } from "../../db/pool.js";

export type RequirementStatus = "SUBMITTED" | "HOD_REVIEW" | "WFM_REVIEW" | "PUBLISHED" | "REJECTED";
export type RequirementAction = "SUBMIT" | "LEADER_APPROVE" | "HOD_APPROVE" | "WFM_APPROVE" | "PUBLISH" | "REJECT" | "SEND_BACK";

export interface CreateRequirementInput {
  businessDate: string;
  locationId?: number | null;
  processId?: number | null;
  departmentId?: number | null;
  shiftId?: number | null;
  requiredHc: number;
  notes?: string | null;
  requestedByUserId: string;
}

export async function createRequirement(input: CreateRequirementInput): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("BusinessDate", sql.Date, input.businessDate)
    .input("LocationId", sql.Int, input.locationId ?? null)
    .input("ProcessId", sql.Int, input.processId ?? null)
    .input("DepartmentId", sql.Int, input.departmentId ?? null)
    .input("ShiftId", sql.Int, input.shiftId ?? null)
    .input("RequiredHC", sql.Int, input.requiredHc)
    .input("Notes", sql.NVarChar(500), input.notes ?? null)
    .input("RequestedByUserId", sql.UniqueIdentifier, input.requestedByUserId)
    .query<{ RosterRequirementId: number }>(`
      INSERT INTO [roster].RosterRequirement (BusinessDate, LocationId, ProcessId, DepartmentId, ShiftId, RequiredHC, Notes, RequestedByUserId)
      OUTPUT INSERTED.RosterRequirementId
      VALUES (@BusinessDate, @LocationId, @ProcessId, @DepartmentId, @ShiftId, @RequiredHC, @Notes, @RequestedByUserId)
    `);
  return result.recordset[0]!.RosterRequirementId;
}

export interface RequirementRow {
  RosterRequirementId: number;
  BusinessDate: string;
  LocationId: number | null;
  LocationName: string | null;
  ProcessId: number | null;
  ProcessName: string | null;
  DepartmentId: number | null;
  DepartmentName: string | null;
  ShiftId: number | null;
  ShiftCode: string | null;
  RequiredHC: number;
  Notes: string | null;
  RequestedByUserId: string;
  RequestedByName: string | null;
  Status: RequirementStatus;
  CreatedAt: Date;
  ModifiedAt: Date;
}

const REQUIREMENT_SELECT = `
  SELECT
    rr.RosterRequirementId, CONVERT(VARCHAR(10), rr.BusinessDate, 23) AS BusinessDate,
    rr.LocationId, loc.LocationName, rr.ProcessId, mp.ProcessName, rr.DepartmentId, dept.DepartmentName,
    rr.ShiftId, sh.ShiftCode, rr.RequiredHC, rr.Notes, rr.RequestedByUserId, u.DisplayName AS RequestedByName,
    rr.Status, rr.CreatedAt, rr.ModifiedAt
  FROM [roster].RosterRequirement rr
  LEFT JOIN [master].Location loc ON loc.LocationId = rr.LocationId
  -- "proc" is rejected by SQL Server as a table alias (Incorrect syntax near
  -- the keyword 'proc') - found by actually running this against a real
  -- server; every other JOIN alias here is a plain unreserved word.
  LEFT JOIN [master].Process mp ON mp.ProcessId = rr.ProcessId
  LEFT JOIN [master].Department dept ON dept.DepartmentId = rr.DepartmentId
  LEFT JOIN [master].Shift sh ON sh.ShiftId = rr.ShiftId
  LEFT JOIN security.[User] u ON u.UserId = rr.RequestedByUserId
`;

export async function getRequirement(id: number): Promise<RequirementRow | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("Id", sql.BigInt, id)
    .query<RequirementRow>(`${REQUIREMENT_SELECT} WHERE rr.RosterRequirementId = @Id`);
  return result.recordset[0] ?? null;
}

export async function listRequirements(params: {
  status?: RequirementStatus;
  businessDateFrom?: string;
  businessDateTo?: string;
  page: number;
  pageSize: number;
}): Promise<PaginatedResult<RequirementRow>> {
  const pool = await getPool();
  const offset = (params.page - 1) * params.pageSize;
  const request = pool.request().input("Offset", sql.Int, offset).input("PageSize", sql.Int, params.pageSize);
  const where: string[] = ["1 = 1"];
  if (params.status) {
    request.input("Status", sql.VarChar(30), params.status);
    where.push("rr.Status = @Status");
  }
  if (params.businessDateFrom) {
    request.input("From", sql.Date, params.businessDateFrom);
    where.push("rr.BusinessDate >= @From");
  }
  if (params.businessDateTo) {
    request.input("To", sql.Date, params.businessDateTo);
    where.push("rr.BusinessDate <= @To");
  }

  const result = await request.query<RequirementRow & { TotalCount: number }>(`
    ${REQUIREMENT_SELECT.replace("SELECT", "SELECT COUNT(*) OVER() AS TotalCount,")}
    WHERE ${where.join(" AND ")}
    ORDER BY rr.BusinessDate DESC, rr.RosterRequirementId DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
  `);
  const totalItems = result.recordset[0]?.TotalCount ?? 0;
  return {
    items: result.recordset.map(({ TotalCount: _TotalCount, ...row }) => row),
    page: params.page,
    pageSize: params.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / params.pageSize)),
  };
}

export async function setRequirementStatus(id: number, status: RequirementStatus): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("Id", sql.BigInt, id)
    .input("Status", sql.VarChar(30), status)
    .query(`UPDATE [roster].RosterRequirement SET Status = @Status, ModifiedAt = SYSUTCDATETIME() WHERE RosterRequirementId = @Id`);
}

export async function recordRequirementAction(input: {
  requirementId: number;
  action: RequirementAction;
  fromStatus: string;
  toStatus: string;
  performedByUserId: string;
  comments?: string | null;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("RequirementId", sql.BigInt, input.requirementId)
    .input("Action", sql.VarChar(30), input.action)
    .input("FromStatus", sql.VarChar(30), input.fromStatus)
    .input("ToStatus", sql.VarChar(30), input.toStatus)
    .input("PerformedByUserId", sql.UniqueIdentifier, input.performedByUserId)
    .input("Comments", sql.NVarChar(500), input.comments ?? null)
    .query(`
      INSERT INTO [roster].RosterRequirementAction (RosterRequirementId, Action, FromStatus, ToStatus, PerformedByUserId, Comments)
      VALUES (@RequirementId, @Action, @FromStatus, @ToStatus, @PerformedByUserId, @Comments)
    `);
}

export async function listRequirementActions(requirementId: number): Promise<
  { action: string; fromStatus: string; toStatus: string; performedByName: string | null; comments: string | null; performedAt: string }[]
> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("RequirementId", sql.BigInt, requirementId)
    .query<{ Action: string; FromStatus: string; ToStatus: string; PerformedByName: string | null; Comments: string | null; PerformedAt: Date }>(`
      SELECT a.Action, a.FromStatus, a.ToStatus, u.DisplayName AS PerformedByName, a.Comments, a.PerformedAt
      FROM [roster].RosterRequirementAction a
      LEFT JOIN security.[User] u ON u.UserId = a.PerformedByUserId
      WHERE a.RosterRequirementId = @RequirementId
      ORDER BY a.PerformedAt
    `);
  return result.recordset.map((r) => ({
    action: r.Action,
    fromStatus: r.FromStatus,
    toStatus: r.ToStatus,
    performedByName: r.PerformedByName,
    comments: r.Comments,
    performedAt: r.PerformedAt.toISOString(),
  }));
}

export async function addAssignment(requirementId: number, employeeId: string, addedByUserId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("RequirementId", sql.BigInt, requirementId)
    .input("EmployeeId", sql.UniqueIdentifier, employeeId)
    .input("AddedByUserId", sql.UniqueIdentifier, addedByUserId)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM [roster].RosterRequirementAssignment WHERE RosterRequirementId = @RequirementId AND EmployeeId = @EmployeeId)
        INSERT INTO [roster].RosterRequirementAssignment (RosterRequirementId, EmployeeId, AddedByUserId) VALUES (@RequirementId, @EmployeeId, @AddedByUserId)
    `);
}

export async function removeAssignment(requirementId: number, employeeId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("RequirementId", sql.BigInt, requirementId)
    .input("EmployeeId", sql.UniqueIdentifier, employeeId)
    .query(`DELETE FROM [roster].RosterRequirementAssignment WHERE RosterRequirementId = @RequirementId AND EmployeeId = @EmployeeId`);
}

export async function listAssignments(requirementId: number): Promise<{ employeeId: string; fullName: string; employeeCode: string }[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("RequirementId", sql.BigInt, requirementId)
    .query<{ EmployeeId: string; FullName: string; EmployeeCode: string }>(`
      SELECT e.EmployeeId, e.FullName, e.EmployeeCode
      FROM [roster].RosterRequirementAssignment a
      JOIN [master].Employee e ON e.EmployeeId = a.EmployeeId
      WHERE a.RosterRequirementId = @RequirementId
      ORDER BY e.FullName
    `);
  return result.recordset.map((r) => ({ employeeId: r.EmployeeId, fullName: r.FullName, employeeCode: r.EmployeeCode }));
}

/**
 * Publishes: for every assigned employee, creates a new active PublishedRoster
 * version and deactivates the previous one. Batched into 3 queries total
 * (regardless of headcount) instead of 2-3 sequential round trips per
 * employee, inside one transaction so a partial failure can't leave some
 * employees published and others not.
 */
export async function publishRequirement(requirementId: number, publishedByUserId: string): Promise<number> {
  const pool = await getPool();
  const requirement = await getRequirement(requirementId);
  if (!requirement) throw new Error("Requirement not found");
  const assignments = await listAssignments(requirementId);
  if (assignments.length === 0) return 0;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const existingRequest = new sql.Request(transaction).input("BusinessDate", sql.Date, requirement.BusinessDate);
    const employeeIdParams = assignments.map((a, i) => {
      existingRequest.input(`EmployeeId${i}`, sql.UniqueIdentifier, a.employeeId);
      return `@EmployeeId${i}`;
    });
    const existing = await existingRequest.query<{ EmployeeId: string; PublishedRosterId: number; Version: number }>(`
      SELECT EmployeeId, PublishedRosterId, Version FROM [roster].PublishedRoster
      WHERE BusinessDate = @BusinessDate AND IsActive = 1 AND EmployeeId IN (${employeeIdParams.join(", ")})
    `);
    const previousByEmployee = new Map(existing.recordset.map((r) => [r.EmployeeId, r]));

    if (existing.recordset.length > 0) {
      const deactivateRequest = new sql.Request(transaction);
      const idParams = existing.recordset.map((r, i) => {
        deactivateRequest.input(`Id${i}`, sql.BigInt, r.PublishedRosterId);
        return `@Id${i}`;
      });
      await deactivateRequest.query(
        `UPDATE [roster].PublishedRoster SET IsActive = 0 WHERE PublishedRosterId IN (${idParams.join(", ")})`,
      );
    }

    const insertRequest = new sql.Request(transaction)
      .input("BusinessDate", sql.Date, requirement.BusinessDate)
      .input("ShiftId", sql.Int, requirement.ShiftId)
      .input("RequirementId", sql.BigInt, requirementId)
      .input("PublishedByUserId", sql.UniqueIdentifier, publishedByUserId);
    const valueRows = assignments.map((a, i) => {
      const version = (previousByEmployee.get(a.employeeId)?.Version ?? 0) + 1;
      insertRequest.input(`EmployeeId${i}`, sql.UniqueIdentifier, a.employeeId);
      insertRequest.input(`Version${i}`, sql.Int, version);
      return `(@EmployeeId${i}, @BusinessDate, @ShiftId, @Version${i}, @RequirementId, @PublishedByUserId)`;
    });
    await insertRequest.query(`
      INSERT INTO [roster].PublishedRoster (EmployeeId, BusinessDate, ShiftId, Version, RosterRequirementId, PublishedByUserId)
      VALUES ${valueRows.join(", ")}
    `);

    await transaction.commit();
    return assignments.length;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export interface PublishedRosterRow {
  publishedRosterId: number;
  employeeId: string;
  employeeName: string;
  businessDate: string;
  shiftCode: string | null;
  version: number;
}

export async function listPublishedRoster(params: { businessDateFrom: string; businessDateTo: string; page: number; pageSize: number }): Promise<
  PaginatedResult<PublishedRosterRow>
> {
  const pool = await getPool();
  const offset = (params.page - 1) * params.pageSize;
  const result = await pool
    .request()
    .input("From", sql.Date, params.businessDateFrom)
    .input("To", sql.Date, params.businessDateTo)
    .input("Offset", sql.Int, offset)
    .input("PageSize", sql.Int, params.pageSize)
    .query<{
      PublishedRosterId: number;
      EmployeeId: string;
      EmployeeName: string;
      BusinessDate: string;
      ShiftCode: string | null;
      Version: number;
      TotalCount: number;
    }>(`
      SELECT
        pr.PublishedRosterId, pr.EmployeeId, e.FullName AS EmployeeName,
        CONVERT(VARCHAR(10), pr.BusinessDate, 23) AS BusinessDate, sh.ShiftCode, pr.Version,
        COUNT(*) OVER() AS TotalCount
      FROM [roster].PublishedRoster pr
      JOIN [master].Employee e ON e.EmployeeId = pr.EmployeeId
      LEFT JOIN [master].Shift sh ON sh.ShiftId = pr.ShiftId
      WHERE pr.IsActive = 1 AND pr.BusinessDate BETWEEN @From AND @To
      ORDER BY pr.BusinessDate, e.FullName
      OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
    `);
  const totalItems = result.recordset[0]?.TotalCount ?? 0;
  return {
    items: result.recordset.map((r) => ({
      publishedRosterId: r.PublishedRosterId,
      employeeId: r.EmployeeId,
      employeeName: r.EmployeeName,
      businessDate: r.BusinessDate,
      shiftCode: r.ShiftCode,
      version: r.Version,
    })),
    page: params.page,
    pageSize: params.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / params.pageSize)),
  };
}

async function getActivePublishedRoster(employeeId: string, businessDate: string): Promise<{ publishedRosterId: number; shiftId: number | null; version: number } | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, employeeId)
    .input("BusinessDate", sql.Date, businessDate)
    .query<{ PublishedRosterId: number; ShiftId: number | null; Version: number }>(`
      SELECT PublishedRosterId, ShiftId, Version FROM [roster].PublishedRoster
      WHERE EmployeeId = @EmployeeId AND BusinessDate = @BusinessDate AND IsActive = 1
    `);
  const row = result.recordset[0];
  return row ? { publishedRosterId: row.PublishedRosterId, shiftId: row.ShiftId, version: row.Version } : null;
}

async function countActiveByShift(businessDate: string, shiftId: number): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("BusinessDate", sql.Date, businessDate)
    .input("ShiftId", sql.Int, shiftId)
    .query<{ Cnt: number }>(`
      SELECT COUNT(*) AS Cnt FROM [roster].PublishedRoster WHERE BusinessDate = @BusinessDate AND ShiftId = @ShiftId AND IsActive = 1
    `);
  return result.recordset[0]!.Cnt;
}

async function getRequiredHc(businessDate: string, shiftId: number): Promise<number | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("BusinessDate", sql.Date, businessDate)
    .input("ShiftId", sql.Int, shiftId)
    .query<{ RequiredHC: number }>(`
      SELECT TOP 1 RequiredHC FROM [roster].RosterRequirement
      WHERE BusinessDate = @BusinessDate AND ShiftId = @ShiftId AND Status IN ('WFM_REVIEW', 'PUBLISHED')
      ORDER BY RosterRequirementId DESC
    `);
  return result.recordset[0]?.RequiredHC ?? null;
}

export interface ShiftImpact {
  shiftId: number;
  shiftCode: string | null;
  beforeHc: number;
  afterHc: number;
  requiredHc: number | null;
  gap: number | null;
}

/** The Change Impact Simulator (build spec section 13) - read-only, never modifies anything. */
export async function simulateShiftChangeImpact(employeeId: string, businessDate: string, newShiftId: number): Promise<{ oldShift: ShiftImpact | null; newShift: ShiftImpact }> {
  const pool = await getPool();
  const current = await getActivePublishedRoster(employeeId, businessDate);

  async function shiftCode(shiftId: number): Promise<string | null> {
    const r = await pool.request().input("Id", sql.Int, shiftId).query<{ ShiftCode: string }>(`SELECT ShiftCode FROM [master].Shift WHERE ShiftId = @Id`);
    return r.recordset[0]?.ShiftCode ?? null;
  }

  let oldShift: ShiftImpact | null = null;
  if (current?.shiftId && current.shiftId !== newShiftId) {
    const before = await countActiveByShift(businessDate, current.shiftId);
    const required = await getRequiredHc(businessDate, current.shiftId);
    const after = before - 1;
    oldShift = { shiftId: current.shiftId, shiftCode: await shiftCode(current.shiftId), beforeHc: before, afterHc: after, requiredHc: required, gap: required != null ? after - required : null };
  }

  const beforeNew = await countActiveByShift(businessDate, newShiftId);
  const requiredNew = await getRequiredHc(businessDate, newShiftId);
  const afterNew = beforeNew + 1;
  const newShift: ShiftImpact = { shiftId: newShiftId, shiftCode: await shiftCode(newShiftId), beforeHc: beforeNew, afterHc: afterNew, requiredHc: requiredNew, gap: requiredNew != null ? afterNew - requiredNew : null };

  return { oldShift, newShift };
}

export async function createRosterChange(input: { employeeId: string; businessDate: string; newShiftId: number; reason: string; requestedByUserId: string }): Promise<number> {
  const pool = await getPool();
  const previous = await getActivePublishedRoster(input.employeeId, input.businessDate);

  if (previous) {
    await pool.request().input("Id", sql.BigInt, previous.publishedRosterId).query(`UPDATE [roster].PublishedRoster SET IsActive = 0 WHERE PublishedRosterId = @Id`);
  }

  const newRoster = await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, input.employeeId)
    .input("BusinessDate", sql.Date, input.businessDate)
    .input("ShiftId", sql.Int, input.newShiftId)
    .input("Version", sql.Int, (previous?.version ?? 0) + 1)
    .input("PublishedByUserId", sql.UniqueIdentifier, input.requestedByUserId)
    .query<{ PublishedRosterId: number }>(`
      INSERT INTO [roster].PublishedRoster (EmployeeId, BusinessDate, ShiftId, Version, PublishedByUserId)
      OUTPUT INSERTED.PublishedRosterId
      VALUES (@EmployeeId, @BusinessDate, @ShiftId, @Version, @PublishedByUserId)
    `);

  const changeResult = await pool
    .request()
    .input("EmployeeId", sql.UniqueIdentifier, input.employeeId)
    .input("BusinessDate", sql.Date, input.businessDate)
    .input("PreviousId", sql.BigInt, previous?.publishedRosterId ?? null)
    .input("NewId", sql.BigInt, newRoster.recordset[0]!.PublishedRosterId)
    .input("Reason", sql.NVarChar(500), input.reason)
    .input("RequestedByUserId", sql.UniqueIdentifier, input.requestedByUserId)
    .query<{ RosterChangeId: number }>(`
      INSERT INTO [roster].RosterChange (EmployeeId, BusinessDate, PreviousPublishedRosterId, NewPublishedRosterId, Reason, RequestedByUserId)
      OUTPUT INSERTED.RosterChangeId
      VALUES (@EmployeeId, @BusinessDate, @PreviousId, @NewId, @Reason, @RequestedByUserId)
    `);
  return changeResult.recordset[0]!.RosterChangeId;
}

export async function listRosterChanges(page: number, pageSize: number): Promise<
  PaginatedResult<{ id: number; employeeName: string; businessDate: string; oldShiftCode: string | null; newShiftCode: string | null; reason: string; requestedByName: string | null; createdAt: string }>
> {
  const pool = await getPool();
  const offset = (page - 1) * pageSize;
  const result = await pool
    .request()
    .input("Offset", sql.Int, offset)
    .input("PageSize", sql.Int, pageSize)
    .query<{
      RosterChangeId: number;
      EmployeeName: string;
      BusinessDate: string;
      OldShiftCode: string | null;
      NewShiftCode: string | null;
      Reason: string;
      RequestedByName: string | null;
      CreatedAt: Date;
      TotalCount: number;
    }>(`
      SELECT
        rc.RosterChangeId, e.FullName AS EmployeeName, CONVERT(VARCHAR(10), rc.BusinessDate, 23) AS BusinessDate,
        oldSh.ShiftCode AS OldShiftCode, newSh.ShiftCode AS NewShiftCode, rc.Reason, u.DisplayName AS RequestedByName, rc.CreatedAt,
        COUNT(*) OVER() AS TotalCount
      FROM [roster].RosterChange rc
      JOIN [master].Employee e ON e.EmployeeId = rc.EmployeeId
      LEFT JOIN [roster].PublishedRoster oldPr ON oldPr.PublishedRosterId = rc.PreviousPublishedRosterId
      LEFT JOIN [master].Shift oldSh ON oldSh.ShiftId = oldPr.ShiftId
      LEFT JOIN [roster].PublishedRoster newPr ON newPr.PublishedRosterId = rc.NewPublishedRosterId
      LEFT JOIN [master].Shift newSh ON newSh.ShiftId = newPr.ShiftId
      LEFT JOIN security.[User] u ON u.UserId = rc.RequestedByUserId
      ORDER BY rc.CreatedAt DESC
      OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY
    `);
  const totalItems = result.recordset[0]?.TotalCount ?? 0;
  return {
    items: result.recordset.map((r) => ({
      id: r.RosterChangeId,
      employeeName: r.EmployeeName,
      businessDate: r.BusinessDate,
      oldShiftCode: r.OldShiftCode,
      newShiftCode: r.NewShiftCode,
      reason: r.Reason,
      requestedByName: r.RequestedByName,
      createdAt: r.CreatedAt.toISOString(),
    })),
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}
