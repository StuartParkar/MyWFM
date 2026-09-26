-- =============================================================================
-- Migration: 0002_configuration_foundation
-- Purpose:   Versioned Configuration Center storage (build spec section 54).
--            Every setting change creates a new row/version rather than
--            overwriting; exactly one version per key may be IsActive=1,
--            enforced by a filtered unique index (not just app-level discipline).
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'config')
    EXEC('CREATE SCHEMA config');
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'config' AND t.name = 'ConfigurationSetting')
BEGIN
    CREATE TABLE config.ConfigurationSetting
    (
        ConfigurationSettingId  INT              NOT NULL IDENTITY(1,1) CONSTRAINT PK_ConfigurationSetting PRIMARY KEY,
        SettingKey              VARCHAR(150)     NOT NULL,
        SettingValue            NVARCHAR(MAX)    NOT NULL, -- JSON-encoded; parsed per ValueType
        ValueType               VARCHAR(20)      NOT NULL CONSTRAINT CK_ConfigurationSetting_ValueType
                                                    CHECK (ValueType IN ('STRING','NUMBER','BOOLEAN','JSON')),
        Category                VARCHAR(60)      NOT NULL,
        Description             NVARCHAR(500)    NULL,
        Version                 INT              NOT NULL CONSTRAINT DF_ConfigurationSetting_Version DEFAULT (1),
        EffectiveDate           DATE             NOT NULL CONSTRAINT DF_ConfigurationSetting_EffectiveDate DEFAULT (CAST(SYSUTCDATETIME() AS DATE)),
        IsActive                BIT              NOT NULL CONSTRAINT DF_ConfigurationSetting_IsActive DEFAULT (1),
        ModifiedBy              UNIQUEIDENTIFIER NULL CONSTRAINT FK_ConfigurationSetting_User REFERENCES security.[User](UserId),
        ModifiedAt              DATETIME2(3)     NOT NULL CONSTRAINT DF_ConfigurationSetting_ModifiedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT UQ_ConfigurationSetting_KeyVersion UNIQUE (SettingKey, Version)
    );

    -- Exactly one active row per key - enforced by the database, not just the app.
    CREATE UNIQUE INDEX UX_ConfigurationSetting_ActiveKey
        ON config.ConfigurationSetting(SettingKey)
        WHERE IsActive = 1;
END
GO
