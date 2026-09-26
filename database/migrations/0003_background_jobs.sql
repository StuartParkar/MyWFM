-- =============================================================================
-- Migration: 0003_background_jobs
-- Purpose:   Durable background job queue (build spec section 67). Long-running
--            work (imports, calculations, exports, backups) is queued here so
--            it survives an API process restart; a worker polls QUEUED rows.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'system')
    EXEC('CREATE SCHEMA [system]');
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'system' AND t.name = 'BackgroundJob')
BEGIN
    CREATE TABLE [system].BackgroundJob
    (
        JobId           BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_BackgroundJob PRIMARY KEY,
        JobType         VARCHAR(100)     NOT NULL,
        Status          VARCHAR(20)      NOT NULL CONSTRAINT DF_BackgroundJob_Status DEFAULT ('QUEUED')
                                            CONSTRAINT CK_BackgroundJob_Status CHECK (Status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
        Payload         NVARCHAR(MAX)    NULL, -- JSON
        Result          NVARCHAR(MAX)    NULL, -- JSON
        ErrorMessage    NVARCHAR(MAX)    NULL,
        Attempts        INT              NOT NULL CONSTRAINT DF_BackgroundJob_Attempts DEFAULT (0),
        MaxAttempts     INT              NOT NULL CONSTRAINT DF_BackgroundJob_MaxAttempts DEFAULT (1),
        CreatedBy       UNIQUEIDENTIFIER NULL CONSTRAINT FK_BackgroundJob_User REFERENCES security.[User](UserId),
        CreatedAt       DATETIME2(3)     NOT NULL CONSTRAINT DF_BackgroundJob_CreatedAt DEFAULT (SYSUTCDATETIME()),
        StartedAt       DATETIME2(3)     NULL,
        CompletedAt     DATETIME2(3)     NULL
    );

    -- The poller only ever looks for QUEUED rows ordered by age - a filtered,
    -- narrow index keeps that scan cheap even once completed jobs pile up.
    CREATE INDEX IX_BackgroundJob_Queued
        ON [system].BackgroundJob(CreatedAt)
        INCLUDE (JobType)
        WHERE Status = 'QUEUED';
END
GO
