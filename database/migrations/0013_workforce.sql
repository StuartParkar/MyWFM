-- =============================================================================
-- Migration: 0013_workforce
-- Purpose:   Phase 10 (Workforce & Scenario Planning). Two genuinely new,
--            forward-looking concepts, neither derivable from existing data:
--              - workforce.WorkforcePlan: a WFM-entered monthly HC target
--                (RequiredHC) plus known planned hires/exits, at whatever
--                combination of Department/Process/Location/Designation the
--                plan is meaningful at (nullable dimensions = "not broken
--                down by this one," the same convention roster.
--                RosterRequirement already uses). Versioned the same way
--                config.ConfigurationSetting/formula.FormulaDefinition are -
--                an edit inserts a new row and deactivates the old one,
--                never overwrites in place.
--              - workforce.Scenario: a saved set of WHAT-IF input
--                assumptions (volume/AHT/shrinkage/HC change) against a real
--                historical baseline period. Only the assumptions are
--                persisted here - the hypothetical *outputs* they produce
--                are computed on read and never written anywhere (not even
--                the Calculation Ledger), matching build spec section 20's
--                "never touches live data" and the same principle Phase 9's
--                OT/VTO capacity-impact preview already established. See
--                documentation/workforce.md.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'workforce')
BEGIN
    EXEC('CREATE SCHEMA [workforce]');
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'workforce' AND t.name = 'WorkforcePlan')
BEGIN
    CREATE TABLE [workforce].WorkforcePlan
    (
        WorkforcePlanId    INT              NOT NULL IDENTITY(1,1) CONSTRAINT PK_WorkforcePlan PRIMARY KEY,
        -- Always the 1st of the target month - a plan is a monthly target, never a specific day.
        BusinessMonth        DATE             NOT NULL,
        DepartmentId          INT              NULL CONSTRAINT FK_WorkforcePlan_Department REFERENCES [master].Department(DepartmentId),
        ProcessId              INT              NULL CONSTRAINT FK_WorkforcePlan_Process REFERENCES [master].Process(ProcessId),
        LocationId              INT              NULL CONSTRAINT FK_WorkforcePlan_Location REFERENCES [master].Location(LocationId),
        DesignationId            INT              NULL CONSTRAINT FK_WorkforcePlan_Designation REFERENCES [master].Designation(DesignationId),
        -- Sentinel (-1) copies of the four dimensions above, PERSISTED so the uniqueness index
        -- below can treat "not broken down by this dimension" (NULL) as one consistent,
        -- matchable value - a plain UNIQUE INDEX on nullable columns would treat every NULL as
        -- distinct (SQL Server's own semantics) and never catch a real duplicate. Same pitfall,
        -- same fix, as intraday.Exception.IntervalStart's own sentinel convention.
        DepartmentKey             AS ISNULL(DepartmentId, -1) PERSISTED,
        ProcessKey                 AS ISNULL(ProcessId, -1) PERSISTED,
        LocationKey                 AS ISNULL(LocationId, -1) PERSISTED,
        DesignationKey               AS ISNULL(DesignationId, -1) PERSISTED,
        RequiredHC                    INT              NOT NULL CONSTRAINT CK_WorkforcePlan_RequiredHC CHECK (RequiredHC >= 0),
        -- Known planned hires/exits by this month - real planning inputs entered by a WFM, not
        -- derived from master.Employee.JoinDate/LeftDate (never populated by the org-hierarchy
        -- import today - see documentation/formulas.md's Attrition callout; this is the same
        -- honest gap, not silently worked around here either).
        PlannedHiresHC                 INT              NOT NULL CONSTRAINT DF_WorkforcePlan_PlannedHiresHC DEFAULT (0) CONSTRAINT CK_WorkforcePlan_PlannedHiresHC CHECK (PlannedHiresHC >= 0),
        PlannedExitsHC                  INT              NOT NULL CONSTRAINT DF_WorkforcePlan_PlannedExitsHC DEFAULT (0) CONSTRAINT CK_WorkforcePlan_PlannedExitsHC CHECK (PlannedExitsHC >= 0),
        Notes                             NVARCHAR(500)    NULL,
        Version                           INT              NOT NULL CONSTRAINT DF_WorkforcePlan_Version DEFAULT (1),
        IsActive                          BIT              NOT NULL CONSTRAINT DF_WorkforcePlan_IsActive DEFAULT (1),
        CreatedByUserId                   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_WorkforcePlan_CreatedBy REFERENCES security.[User](UserId),
        CreatedAt                          DATETIME2(3)     NOT NULL CONSTRAINT DF_WorkforcePlan_CreatedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE UNIQUE INDEX UX_WorkforcePlan_ActiveKey ON [workforce].WorkforcePlan(BusinessMonth, DepartmentKey, ProcessKey, LocationKey, DesignationKey) WHERE IsActive = 1;
    CREATE INDEX IX_WorkforcePlan_BusinessMonth ON [workforce].WorkforcePlan(BusinessMonth);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'workforce' AND t.name = 'Scenario')
BEGIN
    CREATE TABLE [workforce].Scenario
    (
        ScenarioId          INT              NOT NULL IDENTITY(1,1) CONSTRAINT PK_Scenario PRIMARY KEY,
        ScenarioName          NVARCHAR(200)    NOT NULL,
        ProcessId              INT              NULL CONSTRAINT FK_Scenario_Process REFERENCES [master].Process(ProcessId),
        -- The real historical period the scenario's baseline (Offered Calls, AHT, Shrinkage %,
        -- Scheduled HC) is read from at evaluation time - never stored here, always re-read live
        -- from the same Phase 7 formulas everything else uses, so a scenario always reflects
        -- the current real data behind its chosen baseline period, not a stale copy.
        BaselineFrom            DATE             NOT NULL,
        BaselineTo               DATE             NOT NULL CONSTRAINT CK_Scenario_BaselineRange CHECK (BaselineTo >= BaselineFrom),
        VolumeChangePct           DECIMAL(6, 2)    NOT NULL CONSTRAINT DF_Scenario_VolumeChangePct DEFAULT (0),
        AhtChangePct               DECIMAL(6, 2)    NOT NULL CONSTRAINT DF_Scenario_AhtChangePct DEFAULT (0),
        -- NULL = use the baseline period's own real (averaged) Shrinkage % unmodified.
        ShrinkagePctOverride         DECIMAL(6, 2)    NULL,
        HcChange                      INT              NOT NULL CONSTRAINT DF_Scenario_HcChange DEFAULT (0),
        Notes                          NVARCHAR(500)    NULL,
        CreatedByUserId                UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_Scenario_CreatedBy REFERENCES security.[User](UserId),
        CreatedAt                       DATETIME2(3)     NOT NULL CONSTRAINT DF_Scenario_CreatedAt DEFAULT (SYSUTCDATETIME()),
        ModifiedAt                       DATETIME2(3)     NOT NULL CONSTRAINT DF_Scenario_ModifiedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_Scenario_Process ON [workforce].Scenario(ProcessId);
END
GO
