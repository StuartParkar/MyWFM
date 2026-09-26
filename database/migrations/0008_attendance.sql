-- =============================================================================
-- Migration: 0008_attendance
-- Purpose:   Attendance sessions (build spec section 14) that the Business Day
--            Engine (section 9, shared/src/businessDate.ts) and the derived
--            attendance formulas (section 15) are computed from. Multiple
--            sessions per employee/business date are supported on purpose -
--            a "double shift" is two sessions the same day, and First
--            Login/Last Logout/Net Working Hours are all derived (not stored)
--            from the session set, never a single punch pair.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'attendance')
    EXEC('CREATE SCHEMA [attendance]');
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'attendance' AND t.name = 'AttendanceSession')
BEGIN
    CREATE TABLE [attendance].AttendanceSession
    (
        AttendanceSessionId BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_AttendanceSession PRIMARY KEY,
        EmployeeId           UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_AttendanceSession_Employee REFERENCES [master].Employee(EmployeeId),
        -- Denormalized alongside SessionStart rather than derived from it: the whole point of
        -- the Business Day Engine is that an overnight session's business date is NOT simply
        -- the calendar date of either punch, so it must be resolved once (by the caller, via
        -- resolveBusinessDate) and stored, not recomputed with a naive CAST(SessionStart AS DATE).
        BusinessDate           DATE             NOT NULL,
        SessionStart             DATETIME2(3)     NOT NULL,
        SessionEnd                 DATETIME2(3)     NULL CONSTRAINT CK_AttendanceSession_EndAfterStart CHECK (SessionEnd IS NULL OR SessionEnd > SessionStart),
        BreakMinutes                  INT         NOT NULL CONSTRAINT DF_AttendanceSession_BreakMinutes DEFAULT (0) CONSTRAINT CK_AttendanceSession_BreakMinutes CHECK (BreakMinutes >= 0),
        Source                          VARCHAR(20) NOT NULL CONSTRAINT DF_AttendanceSession_Source DEFAULT ('MANUAL')
                                          CONSTRAINT CK_AttendanceSession_Source CHECK (Source IN ('MANUAL', 'IMPORT', 'ADJUSTMENT')),
        RecordedByUserId                  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_AttendanceSession_RecordedBy REFERENCES security.[User](UserId),
        CreatedAt                          DATETIME2(3) NOT NULL CONSTRAINT DF_AttendanceSession_CreatedAt DEFAULT (SYSUTCDATETIME()),
        ModifiedAt                          DATETIME2(3) NOT NULL CONSTRAINT DF_AttendanceSession_ModifiedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_AttendanceSession_EmployeeDate ON [attendance].AttendanceSession(EmployeeId, BusinessDate);
END
GO
