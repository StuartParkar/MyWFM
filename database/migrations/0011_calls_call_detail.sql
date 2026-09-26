-- =============================================================================
-- Migration: 0011_calls_call_detail
-- Purpose:   Adjusts the universal call model (migration 0009) now that real
--            phone-system files have been inspected (build spec section 76):
--            all three systems (Vonage, Elevate, RingCentral) export
--            CALL-DETAIL records (one row per call), never pre-aggregated
--            interval buckets. Offered/Answered/Abandoned/AHTSeconds are
--            aggregate-only concepts - they don't mean anything on a single
--            call - so they're dropped here rather than left as columns that
--            would always be null or misleadingly stored as 0/1. Aggregation
--            into those metrics happens at report time (Phase 7-for-calls,
--            not part of this migration), the same "derive on read, never
--            store the aggregate" discipline already used for Attendance.
--
--            See documentation/phone-system-mapping.md and
--            imports/samples/calls/README.md for the full mapping this
--            schema was designed from.
-- =============================================================================

ALTER TABLE [calls].QueueIntervalCall DROP CONSTRAINT CK_QueueIntervalCall_Direction;
GO
ALTER TABLE [calls].QueueIntervalCall ADD CONSTRAINT CK_QueueIntervalCall_Direction CHECK (Direction IS NULL OR Direction IN ('INBOUND', 'OUTBOUND', 'INTERNAL'));
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('[calls].QueueIntervalCall') AND name = 'Offered')
BEGIN
    ALTER TABLE [calls].QueueIntervalCall DROP COLUMN Offered, Answered, Abandoned, AHTSeconds;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('[calls].QueueIntervalCall') AND name = 'SourceCallId')
BEGIN
    ALTER TABLE [calls].QueueIntervalCall ADD
        -- The raw call/session identifier, verbatim - lets "Explain This Number" drill down
        -- to the original normalized record (build spec section 36).
        SourceCallId NVARCHAR(100) NULL,
        -- Time spent ringing/on hold in the queue before answer/abandon - not in the section
        -- 16 field list, but Vonage QueueWise reports it directly and it's real, useful data
        -- ("Add additional fields after inspecting actual source files").
        WaitSeconds INT NULL,
        -- QueueWise-style sources report the answering agent directly on the same row as the
        -- queue - this is still one logical fact (a queue call, incidentally agent-attributed),
        -- not the same thing as a separately pre-aggregated agent-level record, so it doesn't
        -- violate "don't sum queue-level and agent-level records together".
        SourceAgentId NVARCHAR(100) NULL,
        AgentId UNIQUEIDENTIFIER NULL CONSTRAINT FK_QueueIntervalCall_Agent REFERENCES [master].Employee(EmployeeId),
        AgentName NVARCHAR(200) NULL;
END
GO

ALTER TABLE [calls].AgentIntervalCall DROP CONSTRAINT CK_AgentIntervalCall_Direction;
GO
ALTER TABLE [calls].AgentIntervalCall ADD CONSTRAINT CK_AgentIntervalCall_Direction CHECK (Direction IS NULL OR Direction IN ('INBOUND', 'OUTBOUND', 'INTERNAL'));
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('[calls].AgentIntervalCall') AND name = 'Offered')
BEGIN
    ALTER TABLE [calls].AgentIntervalCall DROP COLUMN Offered, Answered, Abandoned, AHTSeconds;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('[calls].AgentIntervalCall') AND name = 'SourceCallId')
BEGIN
    ALTER TABLE [calls].AgentIntervalCall ADD
        SourceCallId NVARCHAR(100) NULL,
        WaitSeconds INT NULL;
END
GO
