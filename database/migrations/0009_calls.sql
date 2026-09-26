-- =============================================================================
-- Migration: 0009_calls
-- Purpose:   The universal call data model (build spec section 16). Two
--            separate fact tables, not one: queue-level and agent-level call
--            records have different grains and must never be summed together
--            as if they were the same thing ("Do NOT assume queue-level and
--            agent-level records can simply be added together... Create
--            separate logical fact models").
--
--            This migration creates the *target* structure the spec gives
--            verbatim in section 16 - it does not import anything. No
--            phone-system-specific importer exists yet: section 76 requires
--            real sample files from the three phone systems before their
--            column mappings can be built, so these tables stay empty until
--            that importer exists. See documentation/phone-system-mapping.md.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'calls')
    EXEC('CREATE SCHEMA [calls]');
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'calls' AND t.name = 'QueueIntervalCall')
BEGIN
    CREATE TABLE [calls].QueueIntervalCall
    (
        QueueIntervalCallId BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_QueueIntervalCall PRIMARY KEY,
        -- SourceSystem/SourceFile (build spec section 16) are read via this FK rather than
        -- duplicated here, same normalization already used by import.DataQualityIssue -
        -- ImportRun already owns that data, and copying it risks the two drifting apart.
        ImportRunId           BIGINT           NOT NULL CONSTRAINT FK_QueueIntervalCall_ImportRun REFERENCES [import].ImportRun(ImportRunId),
        BusinessDate            DATE             NOT NULL,
        IntervalStart             DATETIME2(3)     NOT NULL,
        IntervalEnd                 DATETIME2(3)     NOT NULL,
        Timezone                     VARCHAR(50)      NOT NULL,
        -- The source file's own queue identifier, verbatim - never mutated, even if QueueId
        -- below fails to resolve (build spec section 16: "preserving... Original identifiers").
        SourceQueueId                 NVARCHAR(100)    NOT NULL,
        QueueId                        INT              NULL CONSTRAINT FK_QueueIntervalCall_Queue REFERENCES [master].Queue(QueueId),
        QueueName                       NVARCHAR(150)    NULL,
        Direction                        VARCHAR(20)      NULL CONSTRAINT CK_QueueIntervalCall_Direction CHECK (Direction IS NULL OR Direction IN ('INBOUND', 'OUTBOUND')),
        Offered                           INT              NULL,
        Answered                           INT              NULL,
        Abandoned                           INT              NULL,
        TalkSeconds                          INT              NULL,
        HoldSeconds                            INT              NULL,
        ACWSeconds                              INT              NULL,
        AHTSeconds                                INT              NULL,
        HandleSeconds                              INT              NULL,
        Disposition                                  NVARCHAR(100)    NULL,
        CreatedAt                                     DATETIME2(3)     NOT NULL CONSTRAINT DF_QueueIntervalCall_CreatedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_QueueIntervalCall_BusinessDate ON [calls].QueueIntervalCall(BusinessDate, QueueId);
    CREATE INDEX IX_QueueIntervalCall_ImportRun ON [calls].QueueIntervalCall(ImportRunId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'calls' AND t.name = 'AgentIntervalCall')
BEGIN
    CREATE TABLE [calls].AgentIntervalCall
    (
        AgentIntervalCallId BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_AgentIntervalCall PRIMARY KEY,
        ImportRunId           BIGINT           NOT NULL CONSTRAINT FK_AgentIntervalCall_ImportRun REFERENCES [import].ImportRun(ImportRunId),
        BusinessDate            DATE             NOT NULL,
        IntervalStart             DATETIME2(3)     NOT NULL,
        IntervalEnd                 DATETIME2(3)     NOT NULL,
        Timezone                     VARCHAR(50)      NOT NULL,
        SourceAgentId                 NVARCHAR(100)    NOT NULL,
        AgentId                         UNIQUEIDENTIFIER NULL CONSTRAINT FK_AgentIntervalCall_Employee REFERENCES [master].Employee(EmployeeId),
        AgentName                        NVARCHAR(200)    NULL,
        -- An agent-interval record commonly still names the queue/skill it was taken on -
        -- nullable because not every phone system's agent-level export will (unknown until a
        -- real file is inspected, per section 76).
        SourceQueueId                     NVARCHAR(100)    NULL,
        QueueId                            INT              NULL CONSTRAINT FK_AgentIntervalCall_Queue REFERENCES [master].Queue(QueueId),
        QueueName                           NVARCHAR(150)    NULL,
        Direction                            VARCHAR(20)      NULL CONSTRAINT CK_AgentIntervalCall_Direction CHECK (Direction IS NULL OR Direction IN ('INBOUND', 'OUTBOUND')),
        Offered                               INT              NULL,
        Answered                               INT              NULL,
        Abandoned                               INT              NULL,
        TalkSeconds                              INT              NULL,
        HoldSeconds                                INT              NULL,
        ACWSeconds                                  INT              NULL,
        AHTSeconds                                    INT              NULL,
        HandleSeconds                                  INT              NULL,
        Disposition                                      NVARCHAR(100)    NULL,
        CreatedAt                                         DATETIME2(3)     NOT NULL CONSTRAINT DF_AgentIntervalCall_CreatedAt DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_AgentIntervalCall_BusinessDate ON [calls].AgentIntervalCall(BusinessDate, AgentId);
    CREATE INDEX IX_AgentIntervalCall_ImportRun ON [calls].AgentIntervalCall(ImportRunId);
END
GO
