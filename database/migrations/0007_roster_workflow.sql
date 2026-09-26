-- =============================================================================
-- Migration: 0007_roster_workflow
-- Purpose:   Roster requirement, its approval workflow (build spec section
--            10: Requestor -> Leader -> HOD -> WFM -> Publish), the
--            published roster (versioned - never overwritten in place, same
--            discipline as config.ConfigurationSetting), and the roster
--            change log (section 12).
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'roster')
    EXEC('CREATE SCHEMA [roster]');
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'roster' AND t.name = 'RosterRequirement')
BEGIN
    CREATE TABLE [roster].RosterRequirement
    (
        RosterRequirementId  BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_RosterRequirement PRIMARY KEY,
        BusinessDate          DATE             NOT NULL,
        LocationId             INT              NULL CONSTRAINT FK_RosterRequirement_Location REFERENCES [master].Location(LocationId),
        ProcessId               INT              NULL CONSTRAINT FK_RosterRequirement_Process REFERENCES [master].Process(ProcessId),
        DepartmentId            INT              NULL CONSTRAINT FK_RosterRequirement_Department REFERENCES [master].Department(DepartmentId),
        ShiftId                  INT              NULL CONSTRAINT FK_RosterRequirement_Shift REFERENCES [master].Shift(ShiftId),
        RequiredHC                INT              NOT NULL,
        Notes                     NVARCHAR(500)    NULL,
        RequestedByUserId          UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_RosterRequirement_RequestedBy REFERENCES security.[User](UserId),
        Status                     VARCHAR(30)      NOT NULL CONSTRAINT DF_RosterRequirement_Status DEFAULT ('SUBMITTED')
                                     CONSTRAINT CK_RosterRequirement_Status CHECK (Status IN
                                       -- A freshly-submitted requirement is awaiting the Leader's review, so
                                       -- 'SUBMITTED' doubles as that state - there is no separate 'LEADER_REVIEW'
                                       -- value (see documentation/roster.md).
                                       ('SUBMITTED', 'HOD_REVIEW', 'WFM_REVIEW', 'PUBLISHED', 'REJECTED')),
        CreatedAt                  DATETIME2(3)     NOT NULL CONSTRAINT DF_RosterRequirement_CreatedAt DEFAULT (SYSUTCDATETIME()),
        ModifiedAt                 DATETIME2(3)     NOT NULL CONSTRAINT DF_RosterRequirement_ModifiedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_RosterRequirement_BusinessDate ON [roster].RosterRequirement(BusinessDate, Status);
END
GO

-- Which employees are proposed to fill a requirement's headcount - editable
-- by the Leader (and HOD) during review (section 10: "Leader must be able to
-- ... add agents, remove agents"). Publish turns this list into real
-- PublishedRoster rows.
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'roster' AND t.name = 'RosterRequirementAssignment')
BEGIN
    CREATE TABLE [roster].RosterRequirementAssignment
    (
        RosterRequirementId BIGINT           NOT NULL CONSTRAINT FK_RosterRequirementAssignment_Requirement REFERENCES [roster].RosterRequirement(RosterRequirementId),
        EmployeeId            UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_RosterRequirementAssignment_Employee REFERENCES [master].Employee(EmployeeId),
        AddedByUserId           UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_RosterRequirementAssignment_AddedBy REFERENCES security.[User](UserId),
        AddedAt                  DATETIME2(3)     NOT NULL CONSTRAINT DF_RosterRequirementAssignment_AddedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_RosterRequirementAssignment PRIMARY KEY (RosterRequirementId, EmployeeId)
    );
END
GO

-- Every submit/approve/reject/send-back is a row here, never just a status
-- flip - this is what section 28's Approval SLA tracking and "every action
-- must be audited" (section 10) actually reads from.
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'roster' AND t.name = 'RosterRequirementAction')
BEGIN
    CREATE TABLE [roster].RosterRequirementAction
    (
        RosterRequirementActionId BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_RosterRequirementAction PRIMARY KEY,
        RosterRequirementId        BIGINT           NOT NULL CONSTRAINT FK_RosterRequirementAction_Requirement REFERENCES [roster].RosterRequirement(RosterRequirementId),
        Action                       VARCHAR(30)      NOT NULL CONSTRAINT CK_RosterRequirementAction_Action CHECK (Action IN
                                        ('SUBMIT', 'LEADER_APPROVE', 'HOD_APPROVE', 'WFM_APPROVE', 'PUBLISH', 'REJECT', 'SEND_BACK')),
        FromStatus                    VARCHAR(30)      NOT NULL,
        ToStatus                      VARCHAR(30)      NOT NULL,
        Comments                      NVARCHAR(500)    NULL,
        PerformedByUserId              UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_RosterRequirementAction_User REFERENCES security.[User](UserId),
        PerformedAt                    DATETIME2(3)     NOT NULL CONSTRAINT DF_RosterRequirementAction_PerformedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_RosterRequirementAction_Requirement ON [roster].RosterRequirementAction(RosterRequirementId, PerformedAt);
END
GO

-- The published roster - versioned like config.ConfigurationSetting: a
-- change never UPDATEs a row in place, it inserts a new Version and
-- deactivates the old one (filtered unique index enforces "exactly one
-- active version per employee+date", not just app discipline).
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'roster' AND t.name = 'PublishedRoster')
BEGIN
    CREATE TABLE [roster].PublishedRoster
    (
        PublishedRosterId    BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_PublishedRoster PRIMARY KEY,
        EmployeeId            UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_PublishedRoster_Employee REFERENCES [master].Employee(EmployeeId),
        BusinessDate           DATE             NOT NULL,
        ShiftId                 INT              NULL CONSTRAINT FK_PublishedRoster_Shift REFERENCES [master].Shift(ShiftId),
        IsWeeklyOff              BIT              NOT NULL CONSTRAINT DF_PublishedRoster_IsWeeklyOff DEFAULT (0),
        Version                  INT              NOT NULL,
        IsActive                 BIT              NOT NULL CONSTRAINT DF_PublishedRoster_IsActive DEFAULT (1),
        RosterRequirementId       BIGINT           NULL CONSTRAINT FK_PublishedRoster_Requirement REFERENCES [roster].RosterRequirement(RosterRequirementId),
        PublishedByUserId          UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_PublishedRoster_PublishedBy REFERENCES security.[User](UserId),
        PublishedAt                 DATETIME2(3)     NOT NULL CONSTRAINT DF_PublishedRoster_PublishedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE UNIQUE INDEX UX_PublishedRoster_ActiveSlot ON [roster].PublishedRoster(EmployeeId, BusinessDate) WHERE IsActive = 1;
    CREATE INDEX IX_PublishedRoster_BusinessDate ON [roster].PublishedRoster(BusinessDate) INCLUDE (ShiftId) WHERE IsActive = 1;
END
GO

-- One row per shift/weekly-off change, always pointing at the version it
-- replaced and the version that replaced it - section 12's "never silently
-- overwrite historical versions" applied to individual assignments, not
-- just whole-roster publishes.
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'roster' AND t.name = 'RosterChange')
BEGIN
    CREATE TABLE [roster].RosterChange
    (
        RosterChangeId           BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_RosterChange PRIMARY KEY,
        EmployeeId                 UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_RosterChange_Employee REFERENCES [master].Employee(EmployeeId),
        BusinessDate                DATE             NOT NULL,
        PreviousPublishedRosterId    BIGINT           NULL CONSTRAINT FK_RosterChange_PreviousRoster REFERENCES [roster].PublishedRoster(PublishedRosterId),
        NewPublishedRosterId          BIGINT           NULL CONSTRAINT FK_RosterChange_NewRoster REFERENCES [roster].PublishedRoster(PublishedRosterId),
        Reason                        NVARCHAR(500)    NOT NULL,
        RequestedByUserId              UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_RosterChange_RequestedBy REFERENCES security.[User](UserId),
        CreatedAt                      DATETIME2(3)     NOT NULL CONSTRAINT DF_RosterChange_CreatedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_RosterChange_EmployeeDate ON [roster].RosterChange(EmployeeId, BusinessDate);
END
GO
