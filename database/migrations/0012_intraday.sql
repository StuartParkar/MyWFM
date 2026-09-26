-- =============================================================================
-- Migration: 0012_intraday
-- Purpose:   Phase 9 (Intraday). Three genuinely new concepts, none derivable
--            from existing tables:
--              - intraday.ExceptionRule / intraday.Exception: the
--                configurable-threshold exception engine (build spec:
--                "staffing, service level, attendance and data quality") and
--                its detected -> acknowledged -> action taken -> resolved
--                lifecycle (the "Actions" screen is a view/workflow over this
--                same table, not a second one - see documentation/intraday.md).
--              - intraday.CapacityAdjustmentRequest: Overtime and VTO share
--                one table (a signed-hours request against a business date,
--                requested -> approved/rejected/cancelled) rather than two
--                near-identical ones.
--              - attendance.BreakSession: real break start/end tracking -
--                needed for Break Management's "present HC minus who's
--                currently on break" and not derivable from
--                AttendanceSession's own single aggregate BreakMinutes field.
--            Interval-level Required/Scheduled/Present/Available HC and
--            Calls/AHT/Occupancy/Service Level need no new schema at all -
--            they're computed on read from existing Shift/PublishedRoster/
--            AttendanceSession/BreakSession/QueueIntervalCall rows, bucketed
--            into a configurable interval (see backend/src/modules/intraday/).
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'intraday')
BEGIN
    EXEC('CREATE SCHEMA [intraday]');
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'intraday' AND t.name = 'ExceptionRule')
BEGIN
    CREATE TABLE [intraday].ExceptionRule
    (
        ExceptionRuleId     INT              NOT NULL IDENTITY(1,1) CONSTRAINT PK_ExceptionRule PRIMARY KEY,
        RuleCode            VARCHAR(50)      NOT NULL,
        Category            VARCHAR(20)      NOT NULL CONSTRAINT CK_ExceptionRule_Category CHECK (Category IN ('STAFFING', 'SERVICE_LEVEL', 'ATTENDANCE', 'DATA_QUALITY')),
        Description         NVARCHAR(300)    NOT NULL,
        -- The value observed is compared to this threshold with ComparisonOperator - e.g.
        -- Category=STAFFING, ComparisonOperator='<', ThresholdValue=-2 fires when a process's
        -- interval Staffing Gap goes below -2. Configurable, not hard-coded, per build spec's
        -- own "configurable-threshold" wording - see Admin > Configuration-adjacent
        -- documentation/intraday.md for the seeded starting values.
        ComparisonOperator  VARCHAR(2)       NOT NULL CONSTRAINT CK_ExceptionRule_Operator CHECK (ComparisonOperator IN ('<', '<=', '>', '>=')),
        ThresholdValue      DECIMAL(18, 4)   NOT NULL,
        IsActive            BIT              NOT NULL CONSTRAINT DF_ExceptionRule_IsActive DEFAULT (1),
        CONSTRAINT UQ_ExceptionRule_Code UNIQUE (RuleCode)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'intraday' AND t.name = 'Exception')
BEGIN
    CREATE TABLE [intraday].Exception
    (
        ExceptionId          BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_Exception PRIMARY KEY,
        ExceptionRuleId      INT              NOT NULL CONSTRAINT FK_Exception_Rule REFERENCES [intraday].ExceptionRule(ExceptionRuleId),
        -- 'Process' | 'Queue' | 'Employee' - whichever this rule's Category naturally attaches
        -- to (Staffing/Service Level -> Process; Attendance -> Employee; Data Quality ->
        -- ImportRun). Verbatim id as text, same convention as formula.CalculationLedger.
        EntityType           VARCHAR(50)      NOT NULL,
        EntityId             VARCHAR(100)     NOT NULL,
        BusinessDate          DATE             NOT NULL,
        -- Midnight of BusinessDate for a whole-day exception type (Attendance, Data Quality);
        -- the real interval start for an interval-level type (Staffing, Service Level) - never
        -- NULL, so the dedup index below works identically for both kinds. See
        -- documentation/intraday.md.
        IntervalStart         DATETIME2(0)     NOT NULL,
        ObservedValue         DECIMAL(18, 4)   NOT NULL,
        -- Snapshot of the rule's threshold at detection time - a later Admin change to the
        -- rule must not silently rewrite what this specific exception was measured against.
        ThresholdValue        DECIMAL(18, 4)   NOT NULL,
        Status                VARCHAR(20)      NOT NULL CONSTRAINT DF_Exception_Status DEFAULT ('DETECTED')
                                CONSTRAINT CK_Exception_Status CHECK (Status IN ('DETECTED', 'ACKNOWLEDGED', 'ACTION_TAKEN', 'RESOLVED')),
        DetectedAt            DATETIME2(3)     NOT NULL CONSTRAINT DF_Exception_DetectedAt DEFAULT (SYSUTCDATETIME()),
        AcknowledgedByUserId  UNIQUEIDENTIFIER NULL CONSTRAINT FK_Exception_AckBy REFERENCES security.[User](UserId),
        AcknowledgedAt        DATETIME2(3)     NULL,
        ActionTaken           NVARCHAR(500)    NULL,
        ActionByUserId        UNIQUEIDENTIFIER NULL CONSTRAINT FK_Exception_ActionBy REFERENCES security.[User](UserId),
        ActionAt              DATETIME2(3)     NULL,
        ResolvedByUserId      UNIQUEIDENTIFIER NULL CONSTRAINT FK_Exception_ResolvedBy REFERENCES security.[User](UserId),
        ResolvedAt            DATETIME2(3)     NULL,
        ResolutionNotes       NVARCHAR(500)    NULL
    );
    -- At most one OPEN (non-resolved) exception per rule/entity/date/interval - detection runs
    -- on demand (no cron - see documentation/troubleshooting.md) and must not spam duplicate
    -- rows every time someone reloads the Exceptions screen for the same breach.
    CREATE UNIQUE INDEX UX_Exception_OpenDedup ON [intraday].Exception(ExceptionRuleId, EntityType, EntityId, BusinessDate, IntervalStart) WHERE Status <> 'RESOLVED';
    CREATE INDEX IX_Exception_BusinessDate ON [intraday].Exception(BusinessDate, Status);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'intraday' AND t.name = 'CapacityAdjustmentRequest')
BEGIN
    CREATE TABLE [intraday].CapacityAdjustmentRequest
    (
        RequestId          INT              NOT NULL IDENTITY(1,1) CONSTRAINT PK_CapacityAdjustmentRequest PRIMARY KEY,
        RequestType        VARCHAR(10)      NOT NULL CONSTRAINT CK_CapacityAdjustmentRequest_Type CHECK (RequestType IN ('OVERTIME', 'VTO')),
        EmployeeId         UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_CapacityAdjustmentRequest_Employee REFERENCES [master].Employee(EmployeeId),
        BusinessDate        DATE             NOT NULL,
        HoursRequested      DECIMAL(5, 2)    NOT NULL CONSTRAINT CK_CapacityAdjustmentRequest_Hours CHECK (HoursRequested > 0),
        Reason              NVARCHAR(300)    NULL,
        Status              VARCHAR(20)      NOT NULL CONSTRAINT DF_CapacityAdjustmentRequest_Status DEFAULT ('REQUESTED')
                              CONSTRAINT CK_CapacityAdjustmentRequest_Status CHECK (Status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
        RequestedByUserId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_CapacityAdjustmentRequest_RequestedBy REFERENCES security.[User](UserId),
        RequestedAt         DATETIME2(3)     NOT NULL CONSTRAINT DF_CapacityAdjustmentRequest_RequestedAt DEFAULT (SYSUTCDATETIME()),
        DecidedByUserId     UNIQUEIDENTIFIER NULL CONSTRAINT FK_CapacityAdjustmentRequest_DecidedBy REFERENCES security.[User](UserId),
        DecidedAt           DATETIME2(3)     NULL,
        DecisionNotes       NVARCHAR(300)    NULL
    );
    CREATE INDEX IX_CapacityAdjustmentRequest_BusinessDate ON [intraday].CapacityAdjustmentRequest(BusinessDate, Status);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'attendance' AND t.name = 'BreakSession')
BEGIN
    CREATE TABLE [attendance].BreakSession
    (
        BreakSessionId    BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_BreakSession PRIMARY KEY,
        EmployeeId         UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_BreakSession_Employee REFERENCES [master].Employee(EmployeeId),
        BusinessDate        DATE             NOT NULL,
        BreakStart           DATETIME2(3)     NOT NULL,
        -- NULL = break still ongoing (mirrors AttendanceSession.SessionEnd's own convention).
        BreakEnd             DATETIME2(3)     NULL,
        Source               VARCHAR(20)      NOT NULL CONSTRAINT DF_BreakSession_Source DEFAULT ('MANUAL')
                              CONSTRAINT CK_BreakSession_Source CHECK (Source IN ('MANUAL', 'IMPORT', 'ADJUSTMENT')),
        CreatedByUserId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_BreakSession_CreatedBy REFERENCES security.[User](UserId),
        CreatedAt            DATETIME2(3)     NOT NULL CONSTRAINT DF_BreakSession_CreatedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_BreakSession_Employee_Date ON [attendance].BreakSession(EmployeeId, BusinessDate);
END
GO
