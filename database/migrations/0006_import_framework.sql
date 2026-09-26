-- =============================================================================
-- Migration: 0006_import_framework
-- Purpose:   Generic Import Center foundation (build spec sections 29-31):
--            every import run is tracked end to end (staged -> validated ->
--            normalized -> duplicate-checked -> data-quality-checked ->
--            merged -> completed/failed) with full counts, and every
--            data-quality anomaly it finds is a row, not a log line that
--            scrolls away. The first concrete import type to run through
--            this (Phase 2's org-hierarchy loader) is wired in application
--            code, not here - this migration only builds the generic shell
--            every future import type (roster/attendance/calls, Phase 3+)
--            will share.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'import')
    EXEC('CREATE SCHEMA [import]');
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'import' AND t.name = 'ImportRun')
BEGIN
    CREATE TABLE [import].ImportRun
    (
        ImportRunId             BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_ImportRun PRIMARY KEY,
        SourceSystem             VARCHAR(50)      NOT NULL,
        SourceType                VARCHAR(50)      NOT NULL,
        FileName                  NVARCHAR(260)    NOT NULL,
        FileSizeBytes              BIGINT           NULL,
        FileHash                   CHAR(64)         NULL,
        UploadedByUserId           UNIQUEIDENTIFIER NULL CONSTRAINT FK_ImportRun_User REFERENCES security.[User](UserId),
        UploadedAt                 DATETIME2(3)     NOT NULL CONSTRAINT DF_ImportRun_UploadedAt DEFAULT (SYSUTCDATETIME()),
        BusinessPeriodStart        DATE             NULL,
        BusinessPeriodEnd          DATE             NULL,
        Status                     VARCHAR(30)      NOT NULL CONSTRAINT DF_ImportRun_Status DEFAULT ('STAGED')
                                     CONSTRAINT CK_ImportRun_Status CHECK (Status IN
                                       ('STAGED', 'VALIDATING', 'NORMALIZING', 'DUPLICATE_CHECK', 'DATA_QUALITY', 'MERGING', 'COMPLETED', 'FAILED')),
        RecordsReceived            INT              NULL,
        RecordsAccepted            INT              NULL,
        RecordsRejected            INT              NULL,
        RecordsInserted            INT              NULL,
        RecordsUpdated             INT              NULL,
        RecordsDuplicate           INT              NULL,
        MappingVersion             VARCHAR(30)      NULL,
        NormalizationVersion       VARCHAR(30)      NULL,
        ErrorMessage               NVARCHAR(MAX)    NULL,
        StartedAt                  DATETIME2(3)     NULL,
        CompletedAt                DATETIME2(3)     NULL,
        DurationMs                 INT              NULL
    );
    CREATE INDEX IX_ImportRun_SourceSystem ON [import].ImportRun(SourceSystem, UploadedAt DESC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'import' AND t.name = 'DataQualityIssue')
BEGIN
    CREATE TABLE [import].DataQualityIssue
    (
        DataQualityIssueId  BIGINT        NOT NULL IDENTITY(1,1) CONSTRAINT PK_DataQualityIssue PRIMARY KEY,
        ImportRunId          BIGINT        NOT NULL CONSTRAINT FK_DataQualityIssue_ImportRun REFERENCES [import].ImportRun(ImportRunId),
        Severity              VARCHAR(20)   NOT NULL CONSTRAINT CK_DataQualityIssue_Severity CHECK (Severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
        IssueType              VARCHAR(50)   NOT NULL,
        RecordReference         NVARCHAR(200) NULL,
        Description              NVARCHAR(500) NOT NULL,
        SuggestedAction          NVARCHAR(500) NULL,
        Status                    VARCHAR(20)   NOT NULL CONSTRAINT DF_DataQualityIssue_Status DEFAULT ('OPEN')
                                    CONSTRAINT CK_DataQualityIssue_Status CHECK (Status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED')),
        CreatedAt                 DATETIME2(3)  NOT NULL CONSTRAINT DF_DataQualityIssue_CreatedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_DataQualityIssue_ImportRun ON [import].DataQualityIssue(ImportRunId);
    CREATE INDEX IX_DataQualityIssue_Status ON [import].DataQualityIssue(Status, Severity);
END
GO
