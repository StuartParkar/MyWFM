-- =============================================================================
-- Migration: 0004_master_data_foundation
-- Purpose:   Employee/organization master data (build spec section 56),
--            designed from the real hierarchy sample in
--            imports/samples/master-data/ rather than a guessed shape - see
--            that folder's README for the "why" behind each design choice
--            below (self-referencing hierarchy, alias resolution, vacant
--            placeholders, EmployeeProcess many-to-many).
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'master')
    EXEC('CREATE SCHEMA [master]');
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'Location')
BEGIN
    CREATE TABLE [master].Location
    (
        LocationId      INT             NOT NULL IDENTITY(1,1) CONSTRAINT PK_Location PRIMARY KEY,
        LocationCode    VARCHAR(20)     NOT NULL,
        LocationName    NVARCHAR(100)   NOT NULL,
        IsActive        BIT             NOT NULL CONSTRAINT DF_Location_IsActive DEFAULT (1),
        CreatedAt       DATETIME2(3)    NOT NULL CONSTRAINT DF_Location_CreatedAt DEFAULT (SYSUTCDATETIME()),
        ModifiedAt      DATETIME2(3)    NOT NULL CONSTRAINT DF_Location_ModifiedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT UQ_Location_Code UNIQUE (LocationCode)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'Process')
BEGIN
    CREATE TABLE [master].Process
    (
        ProcessId       INT             NOT NULL IDENTITY(1,1) CONSTRAINT PK_Process PRIMARY KEY,
        ProcessCode     VARCHAR(30)     NOT NULL,
        ProcessName     NVARCHAR(100)   NOT NULL,
        IsActive        BIT             NOT NULL CONSTRAINT DF_Process_IsActive DEFAULT (1),
        CreatedAt       DATETIME2(3)    NOT NULL CONSTRAINT DF_Process_CreatedAt DEFAULT (SYSUTCDATETIME()),
        ModifiedAt      DATETIME2(3)    NOT NULL CONSTRAINT DF_Process_ModifiedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT UQ_Process_Code UNIQUE (ProcessCode)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'Department')
BEGIN
    CREATE TABLE [master].Department
    (
        DepartmentId    INT             NOT NULL IDENTITY(1,1) CONSTRAINT PK_Department PRIMARY KEY,
        DepartmentName  NVARCHAR(100)   NOT NULL,
        IsActive        BIT             NOT NULL CONSTRAINT DF_Department_IsActive DEFAULT (1),
        CreatedAt       DATETIME2(3)    NOT NULL CONSTRAINT DF_Department_CreatedAt DEFAULT (SYSUTCDATETIME()),
        ModifiedAt      DATETIME2(3)    NOT NULL CONSTRAINT DF_Department_ModifiedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT UQ_Department_Name UNIQUE (DepartmentName)
    );
END
GO

-- Hierarchy levels, ordered by seniority. Every employee's own designation is
-- derived (not sourced directly - the raw data has no such column) from the
-- highest level at which their alias is referenced as someone else's leader;
-- see backend/src/scripts/importOrgHierarchy.ts.
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'Designation')
BEGIN
    CREATE TABLE [master].Designation
    (
        DesignationId   INT             NOT NULL IDENTITY(1,1) CONSTRAINT PK_Designation PRIMARY KEY,
        DesignationCode VARCHAR(30)     NOT NULL,
        DesignationName NVARCHAR(100)   NOT NULL,
        HierarchyLevel  INT             NOT NULL,
        CONSTRAINT UQ_Designation_Code UNIQUE (DesignationCode),
        CONSTRAINT UQ_Designation_Level UNIQUE (HierarchyLevel)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'Employee')
BEGIN
    CREATE TABLE [master].Employee
    (
        EmployeeId              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Employee PRIMARY KEY CONSTRAINT DF_Employee_Id DEFAULT (NEWSEQUENTIALID()),
        EmployeeCode             VARCHAR(20)      NOT NULL, -- business key ("Emp ID" in source)
        FullName                 NVARCHAR(200)    NOT NULL,
        AliasName                NVARCHAR(100)    NULL,
        LocationId               INT              NULL CONSTRAINT FK_Employee_Location REFERENCES [master].Location(LocationId),
        DepartmentId             INT              NULL CONSTRAINT FK_Employee_Department REFERENCES [master].Department(DepartmentId),
        DesignationId            INT              NULL CONSTRAINT FK_Employee_Designation REFERENCES [master].Designation(DesignationId),
        UserId                   UNIQUEIDENTIFIER NULL CONSTRAINT FK_Employee_User REFERENCES security.[User](UserId),
        SmeEmployeeId            UNIQUEIDENTIFIER NULL CONSTRAINT FK_Employee_Sme REFERENCES [master].Employee(EmployeeId),
        TeamLeaderEmployeeId     UNIQUEIDENTIFIER NULL CONSTRAINT FK_Employee_TeamLeader REFERENCES [master].Employee(EmployeeId),
        AmEmployeeId             UNIQUEIDENTIFIER NULL CONSTRAINT FK_Employee_Am REFERENCES [master].Employee(EmployeeId),
        ManagerEmployeeId        UNIQUEIDENTIFIER NULL CONSTRAINT FK_Employee_Manager REFERENCES [master].Employee(EmployeeId),
        SrManagerEmployeeId      UNIQUEIDENTIFIER NULL CONSTRAINT FK_Employee_SrManager REFERENCES [master].Employee(EmployeeId),
        UnitHodEmployeeId        UNIQUEIDENTIFIER NULL CONSTRAINT FK_Employee_UnitHod REFERENCES [master].Employee(EmployeeId),
        -- Populated instead of *EmployeeId above when the source names a
        -- vacant/placeholder leader (e.g. "TBA-Paul") that isn't a real employee.
        VacantTeamLeaderLabel    NVARCHAR(50)     NULL,
        JoinDate                 DATE             NULL,
        LeftDate                 DATE             NULL,
        IsActive                 BIT              NOT NULL CONSTRAINT DF_Employee_IsActive DEFAULT (1),
        CreatedAt                DATETIME2(3)     NOT NULL CONSTRAINT DF_Employee_CreatedAt DEFAULT (SYSUTCDATETIME()),
        ModifiedAt                DATETIME2(3)     NOT NULL CONSTRAINT DF_Employee_ModifiedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT UQ_Employee_Code UNIQUE (EmployeeCode)
    );
    CREATE INDEX IX_Employee_TeamLeader ON [master].Employee(TeamLeaderEmployeeId);
    CREATE INDEX IX_Employee_UnitHod ON [master].Employee(UnitHodEmployeeId);
    CREATE INDEX IX_Employee_Department ON [master].Employee(DepartmentId);
    CREATE INDEX IX_Employee_AliasName ON [master].Employee(AliasName);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'EmployeeProcess')
BEGIN
    CREATE TABLE [master].EmployeeProcess
    (
        EmployeeId  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_EmployeeProcess_Employee REFERENCES [master].Employee(EmployeeId),
        ProcessId   INT              NOT NULL CONSTRAINT FK_EmployeeProcess_Process REFERENCES [master].Process(ProcessId),
        IsPrimary   BIT              NOT NULL CONSTRAINT DF_EmployeeProcess_IsPrimary DEFAULT (0),
        CONSTRAINT PK_EmployeeProcess PRIMARY KEY (EmployeeId, ProcessId)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'Shift')
BEGIN
    CREATE TABLE [master].Shift
    (
        ShiftId      INT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_Shift PRIMARY KEY,
        ShiftCode    VARCHAR(20)   NOT NULL,
        StartTime    TIME          NOT NULL,
        EndTime      TIME          NOT NULL,
        IsOvernight  BIT           NOT NULL,
        Description  NVARCHAR(200) NULL,
        IsActive     BIT           NOT NULL CONSTRAINT DF_Shift_IsActive DEFAULT (1),
        CONSTRAINT UQ_Shift_Code UNIQUE (ShiftCode)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'Queue')
BEGIN
    CREATE TABLE [master].Queue
    (
        QueueId    INT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_Queue PRIMARY KEY,
        QueueCode  VARCHAR(50)   NOT NULL,
        QueueName  NVARCHAR(150) NOT NULL,
        ProcessId  INT           NULL CONSTRAINT FK_Queue_Process REFERENCES [master].Process(ProcessId),
        IsActive   BIT           NOT NULL CONSTRAINT DF_Queue_IsActive DEFAULT (1),
        CONSTRAINT UQ_Queue_Code UNIQUE (QueueCode)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'Skill')
BEGIN
    CREATE TABLE [master].Skill
    (
        SkillId    INT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_Skill PRIMARY KEY,
        SkillCode  VARCHAR(50)   NOT NULL,
        SkillName  NVARCHAR(150) NOT NULL,
        IsActive   BIT           NOT NULL CONSTRAINT DF_Skill_IsActive DEFAULT (1),
        CONSTRAINT UQ_Skill_Code UNIQUE (SkillCode)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'EmployeeSkill')
BEGIN
    CREATE TABLE [master].EmployeeSkill
    (
        EmployeeId       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_EmployeeSkill_Employee REFERENCES [master].Employee(EmployeeId),
        SkillId          INT              NOT NULL CONSTRAINT FK_EmployeeSkill_Skill REFERENCES [master].Skill(SkillId),
        ProficiencyLevel VARCHAR(20)      NULL,
        CONSTRAINT PK_EmployeeSkill PRIMARY KEY (EmployeeId, SkillId)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'QueueSkillRequirement')
BEGIN
    CREATE TABLE [master].QueueSkillRequirement
    (
        QueueId  INT NOT NULL CONSTRAINT FK_QueueSkillRequirement_Queue REFERENCES [master].Queue(QueueId),
        SkillId  INT NOT NULL CONSTRAINT FK_QueueSkillRequirement_Skill REFERENCES [master].Skill(SkillId),
        CONSTRAINT PK_QueueSkillRequirement PRIMARY KEY (QueueId, SkillId)
    );
END
GO

-- Deferred from Phase 1 (0001_security_foundation.sql) - master.Employee did
-- not exist yet. Links a login account to its employee/HR record.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('security.[User]') AND name = 'EmployeeId')
BEGIN
    ALTER TABLE security.[User] ADD EmployeeId UNIQUEIDENTIFIER NULL CONSTRAINT FK_User_Employee REFERENCES [master].Employee(EmployeeId);
END
GO
