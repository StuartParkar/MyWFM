-- =============================================================================
-- Migration: 0010_calculation_engine
-- Purpose:   Shrinkage (build spec section 20) and the cross-cutting
--            calculation infrastructure section 6's architecture diagram
--            calls for: a versioned Formula Library and a Calculation
--            Ledger (every computed KPI's value, formula version and inputs,
--            not just the number - see documentation/formulas.md).
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'shrinkage')
    EXEC('CREATE SCHEMA [shrinkage]');
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'shrinkage' AND t.name = 'ShrinkageCategory')
BEGIN
    CREATE TABLE [shrinkage].ShrinkageCategory
    (
        ShrinkageCategoryId INT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_ShrinkageCategory PRIMARY KEY,
        CategoryCode          VARCHAR(30)   NOT NULL CONSTRAINT UQ_ShrinkageCategory_Code UNIQUE,
        CategoryName            NVARCHAR(100) NOT NULL,
        IsActive                  BIT           NOT NULL CONSTRAINT DF_ShrinkageCategory_IsActive DEFAULT (1)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'shrinkage' AND t.name = 'ShrinkageEntry')
BEGIN
    CREATE TABLE [shrinkage].ShrinkageEntry
    (
        ShrinkageEntryId BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_ShrinkageEntry PRIMARY KEY,
        EmployeeId         UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_ShrinkageEntry_Employee REFERENCES [master].Employee(EmployeeId),
        BusinessDate         DATE             NOT NULL,
        ShrinkageCategoryId    INT              NOT NULL CONSTRAINT FK_ShrinkageEntry_Category REFERENCES [shrinkage].ShrinkageCategory(ShrinkageCategoryId),
        Minutes                  INT              NOT NULL CONSTRAINT CK_ShrinkageEntry_Minutes CHECK (Minutes > 0),
        Source                     VARCHAR(20)      NOT NULL CONSTRAINT DF_ShrinkageEntry_Source DEFAULT ('MANUAL')
                                     CONSTRAINT CK_ShrinkageEntry_Source CHECK (Source IN ('MANUAL', 'IMPORT', 'ADJUSTMENT')),
        Notes                        NVARCHAR(500)    NULL,
        RecordedByUserId               UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_ShrinkageEntry_RecordedBy REFERENCES security.[User](UserId),
        CreatedAt                       DATETIME2(3)     NOT NULL CONSTRAINT DF_ShrinkageEntry_CreatedAt DEFAULT (SYSUTCDATETIME()),
        ModifiedAt                       DATETIME2(3)     NOT NULL CONSTRAINT DF_ShrinkageEntry_ModifiedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_ShrinkageEntry_EmployeeDate ON [shrinkage].ShrinkageEntry(EmployeeId, BusinessDate);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'formula')
    EXEC('CREATE SCHEMA [formula]');
GO

-- The catalog is metadata (name/description/version/effective date), never an executable
-- expression - per build spec section 2 ("No AI... use... mathematical formulas" as real
-- deterministic code), the actual computation is a reviewed TypeScript function; this table
-- lets that function's version and intent be browsed (section 24 "Formula Management")
-- without inventing a formula-expression language nobody asked for.
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'formula' AND t.name = 'FormulaDefinition')
BEGIN
    CREATE TABLE [formula].FormulaDefinition
    (
        FormulaDefinitionId INT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_FormulaDefinition PRIMARY KEY,
        FormulaCode           VARCHAR(50)   NOT NULL,
        Version                 INT           NOT NULL,
        IsActive                  BIT           NOT NULL CONSTRAINT DF_FormulaDefinition_IsActive DEFAULT (1),
        Name                        NVARCHAR(150) NOT NULL,
        Description                   NVARCHAR(500) NOT NULL,
        Category                       VARCHAR(50)   NOT NULL,
        EffectiveFrom                    DATE          NOT NULL,
        CreatedByUserId                   UNIQUEIDENTIFIER NULL CONSTRAINT FK_FormulaDefinition_CreatedBy REFERENCES security.[User](UserId),
        CreatedAt                          DATETIME2(3)  NOT NULL CONSTRAINT DF_FormulaDefinition_CreatedAt DEFAULT (SYSUTCDATETIME())
    );
    -- Exactly one active version per formula code - same filtered-unique-index discipline as
    -- config.ConfigurationSetting and roster.PublishedRoster.
    CREATE UNIQUE INDEX UX_FormulaDefinition_ActiveCode ON [formula].FormulaDefinition(FormulaCode) WHERE IsActive = 1;
END
GO

-- Append-only by design (build spec section 6's architecture: Calculation Engine writes
-- here, Dashboard/Reports/Control Tower read from here) - a recalculation after a data
-- correction inserts a new row rather than overwriting the old one, so "what did we compute,
-- and with what formula version, at the time" (section 23 Data Lineage) is never lost.
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'formula' AND t.name = 'CalculationLedger')
BEGIN
    CREATE TABLE [formula].CalculationLedger
    (
        CalculationLedgerId BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_CalculationLedger PRIMARY KEY,
        FormulaCode           VARCHAR(50)      NOT NULL,
        FormulaVersion          INT              NOT NULL,
        EntityType                VARCHAR(50)      NOT NULL,
        EntityId                    VARCHAR(100)     NOT NULL,
        BusinessDate                  DATE             NOT NULL,
        ComputedValue                   DECIMAL(18,4)    NOT NULL,
        InputsSnapshot                    NVARCHAR(MAX)    NULL,
        -- "Source Data Version" in the build spec's own worked example (e.g. an IMPORT-*
        -- code) - null for now, since Shrinkage and Staffing both compute from manually
        -- entered data with no import run to cite; a formula computed from imported data
        -- (once one exists) would populate this.
        SourceReference                    NVARCHAR(100)    NULL,
        ComputedByUserId                    UNIQUEIDENTIFIER NULL CONSTRAINT FK_CalculationLedger_ComputedBy REFERENCES security.[User](UserId),
        ComputedAt                            DATETIME2(3)     NOT NULL CONSTRAINT DF_CalculationLedger_ComputedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_CalculationLedger_Lookup ON [formula].CalculationLedger(FormulaCode, EntityType, EntityId, BusinessDate, ComputedAt DESC);
END
GO
