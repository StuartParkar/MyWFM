-- =============================================================================
-- Migration: 0005_master_data_extensions
-- Purpose:   The remaining master-data entities from build spec section 56
--            not yet covered by 0004: holidays, weekly-off patterns, and a
--            generic reason-code table later phases (leave, VTO, exceptions)
--            will each define their own Category for rather than each
--            inventing their own lookup table.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'Holiday')
BEGIN
    CREATE TABLE [master].Holiday
    (
        HolidayId    INT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_Holiday PRIMARY KEY,
        HolidayDate  DATE          NOT NULL,
        HolidayName  NVARCHAR(150) NOT NULL,
        -- NULL = applies to every location.
        LocationId   INT           NULL CONSTRAINT FK_Holiday_Location REFERENCES [master].Location(LocationId),
        IsActive     BIT           NOT NULL CONSTRAINT DF_Holiday_IsActive DEFAULT (1),
        CreatedAt    DATETIME2(3)  NOT NULL CONSTRAINT DF_Holiday_CreatedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_Holiday_Date ON [master].Holiday(HolidayDate);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'WeeklyOffPattern')
BEGIN
    CREATE TABLE [master].WeeklyOffPattern
    (
        WeeklyOffPatternId INT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_WeeklyOffPattern PRIMARY KEY,
        PatternCode        VARCHAR(30)   NOT NULL,
        PatternName        NVARCHAR(100) NOT NULL,
        -- Comma-separated day names (e.g. "SAT,SUN") - simple by design; a
        -- rotating/variable pattern is a roster-assignment concern (Phase 4),
        -- not a master-data shape concern.
        DaysOff            VARCHAR(50)   NOT NULL,
        IsActive           BIT           NOT NULL CONSTRAINT DF_WeeklyOffPattern_IsActive DEFAULT (1),
        CONSTRAINT UQ_WeeklyOffPattern_Code UNIQUE (PatternCode)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'master' AND t.name = 'ReasonCode')
BEGIN
    CREATE TABLE [master].ReasonCode
    (
        ReasonCodeId INT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_ReasonCode PRIMARY KEY,
        Category     VARCHAR(50)   NOT NULL, -- e.g. 'LEAVE', 'VTO', 'ATTENDANCE_ADJUSTMENT', 'EXCEPTION_ACK'
        Code         VARCHAR(30)   NOT NULL,
        Description  NVARCHAR(200) NULL,
        IsActive     BIT           NOT NULL CONSTRAINT DF_ReasonCode_IsActive DEFAULT (1),
        CONSTRAINT UQ_ReasonCode_CategoryCode UNIQUE (Category, Code)
    );
END
GO
