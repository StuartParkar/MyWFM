-- =============================================================================
-- Migration: 0014_attrition
-- Purpose:   Completes build spec section 22 (Attrition: opening/closing HC,
--            joiners, exits, transfers, attrition rate), deferred since
--            Phase 7 because the one real org-hierarchy source file
--            (imports/samples/master-data/employee-org-hierarchy-*.tsv) has
--            no join-date/exit-date column at all - see
--            documentation/attrition.md for the full reasoning.
--
--            Two real, non-fabricated signals now feed it:
--              - master.Employee.JoinDate/LeftDate (added in Phase 2's
--                migration 0004, never populated by anything until now):
--                the org-hierarchy importer sets these itself going forward
--                (first-seen on insert, last-seen-then-missing on a later
--                re-import), and Admin > Employees now lets a real
--                HR-confirmed date be entered manually, which always wins
--                over the importer's own inference (see
--                orgHierarchyImporter.ts).
--              - master.EmployeeTransfer (new): a Department/Location/
--                primary-Process change has no history in Employee's own
--                current-state columns - a dedicated append-only log is the
--                only honest way to count "how many transfers happened in
--                March," the same reasoning that gave Roster/Config/Formula
--                their own versioned-history tables rather than overwriting
--                in place.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'EmployeeTransfer')
BEGIN
    CREATE TABLE [master].EmployeeTransfer
    (
        EmployeeTransferId      BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_EmployeeTransfer PRIMARY KEY,
        EmployeeId               UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_EmployeeTransfer_Employee REFERENCES [master].Employee(EmployeeId),
        -- The import's own effective date (or the day of a manual Admin edit) - never a naive
        -- "today," since a backfilled historical import may itself be dated in the past.
        EffectiveDate             DATE             NOT NULL,
        PreviousDepartmentId       INT              NULL CONSTRAINT FK_EmployeeTransfer_PrevDept REFERENCES [master].Department(DepartmentId),
        NewDepartmentId             INT              NULL CONSTRAINT FK_EmployeeTransfer_NewDept REFERENCES [master].Department(DepartmentId),
        PreviousLocationId           INT              NULL CONSTRAINT FK_EmployeeTransfer_PrevLoc REFERENCES [master].Location(LocationId),
        NewLocationId                 INT              NULL CONSTRAINT FK_EmployeeTransfer_NewLoc REFERENCES [master].Location(LocationId),
        -- "Primary process" (master.EmployeeProcess.IsPrimary = 1) - the same single "home"
        -- process Workforce Planning's Current HC already counts by (documentation/workforce.md).
        PreviousPrimaryProcessId       INT              NULL CONSTRAINT FK_EmployeeTransfer_PrevProcess REFERENCES [master].Process(ProcessId),
        NewPrimaryProcessId               INT              NULL CONSTRAINT FK_EmployeeTransfer_NewProcess REFERENCES [master].Process(ProcessId),
        -- NULL when detected from a manual Admin > Employees edit rather than a re-import.
        SourceImportRunId                 BIGINT           NULL CONSTRAINT FK_EmployeeTransfer_ImportRun REFERENCES [import].ImportRun(ImportRunId),
        DetectedAt                         DATETIME2(3)     NOT NULL CONSTRAINT DF_EmployeeTransfer_DetectedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_EmployeeTransfer_Employee ON [master].EmployeeTransfer(EmployeeId, EffectiveDate);
    CREATE INDEX IX_EmployeeTransfer_EffectiveDate ON [master].EmployeeTransfer(EffectiveDate);
END
GO

-- One-time backfill: every employee already in the table before this migration has a NULL
-- JoinDate (nothing has ever set it). CreatedAt is a real timestamp (when this system's own row
-- was created) - not the same thing as a real HR hire date, but a genuine fact rather than an
-- invented one, and the honest best available answer to "since when has this system known
-- about them." Never overwrites a JoinDate that (going forward) is already set.
UPDATE [master].Employee
SET JoinDate = CAST(CreatedAt AS DATE)
WHERE JoinDate IS NULL;
GO
