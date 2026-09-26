-- =============================================================================
-- Migration: 0015_phase11
-- Purpose:   Phase 11 (build spec: audit/lineage, reprocessing, system health
--            history, backup/restore automation). Two new tables:
--              - system.HealthSnapshot: the System Health screen (Phase 1)
--                only ever reported a live, un-persisted snapshot
--                (GET /api/system-health/detail) - this lets a periodic
--                sampler (health.snapshotSampler.ts) keep real history rather
--                than only ever showing "right now."
--              - system.ReprocessingRequest: an authorized, audited record of
--                an on-demand recalculation - who asked, what scope, why
--                (Reason is mandatory), and the real result. It does not
--                duplicate any calculation: every calculation type it can
--                target already recomputes and writes a fresh
--                formula.CalculationLedger row on every normal read
--                (documentation/formulas.md) - this table exists so that an
--                explicit, reasoned request for one is itself a first-class,
--                auditable fact instead of indistinguishable from someone
--                just reloading a report.
--            Backup automation deliberately needs no new table: system.
--            BackgroundJob (migration 0003)'s own purpose comment already
--            names "backups" - a JobType = 'RUN_BACKUP' row is a real,
--            already-durable, already-retryable record of one backup run.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'system' AND t.name = 'HealthSnapshot')
BEGIN
    CREATE TABLE [system].HealthSnapshot
    (
        SnapshotId          BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_HealthSnapshot PRIMARY KEY,
        CapturedAt           DATETIME2(3)     NOT NULL CONSTRAINT DF_HealthSnapshot_CapturedAt DEFAULT (SYSUTCDATETIME()),
        Status                 VARCHAR(20)      NOT NULL CONSTRAINT CK_HealthSnapshot_Status CHECK (Status IN ('UP','DEGRADED','DOWN')),
        DatabaseStatus           VARCHAR(10)      NOT NULL CONSTRAINT CK_HealthSnapshot_DbStatus CHECK (DatabaseStatus IN ('UP','DOWN')),
        DatabaseLatencyMs          INT              NULL,
        JobsQueued                   INT              NOT NULL,
        JobsRunning                    INT              NOT NULL,
        JobsFailedLast24h                INT              NOT NULL
    );
    CREATE INDEX IX_HealthSnapshot_CapturedAt ON [system].HealthSnapshot(CapturedAt);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'system' AND t.name = 'ReprocessingRequest')
BEGIN
    CREATE TABLE [system].ReprocessingRequest
    (
        RequestId              BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_ReprocessingRequest PRIMARY KEY,
        CalculationType         VARCHAR(50)      NOT NULL,
        FromDate                  DATE             NOT NULL,
        ToDate                      DATE             NOT NULL,
        -- The dimension filters actually used (processId/departmentId/queueId/... - whichever the
        -- chosen calculation type really supports), for display only - never re-parsed by code.
        ScopeJson                     NVARCHAR(500)    NULL,
        Reason                          NVARCHAR(500)    NOT NULL,
        RequestedByUserId                 UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_ReprocessingRequest_User REFERENCES security.[User](UserId),
        RequestedAt                         DATETIME2(3)     NOT NULL CONSTRAINT DF_ReprocessingRequest_RequestedAt DEFAULT (SYSUTCDATETIME()),
        Status                                 VARCHAR(20)      NOT NULL CONSTRAINT CK_ReprocessingRequest_Status CHECK (Status IN ('COMPLETED','FAILED')),
        ResultSummary                             NVARCHAR(MAX)    NULL, -- JSON
        ErrorMessage                                NVARCHAR(MAX)    NULL
    );
    CREATE INDEX IX_ReprocessingRequest_RequestedAt ON [system].ReprocessingRequest(RequestedAt);
END
GO
