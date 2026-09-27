-- =============================================================================
-- Migration: 0016_performance_indexes
-- Purpose:   Phase 12 hardening. Three foreign-key columns were left without a
--            supporting index since their introducing migration, found by
--            cross-referencing every FK/filter column against every
--            CREATE INDEX in the migration set:
--              - calls.QueueIntervalCall.AgentId  (added in 0011, never indexed)
--              - calls.AgentIntervalCall.QueueId  (0009, never indexed)
--              - attendance.AttendanceSession.RecordedByUserId (0008, never indexed)
--            The first two are on the highest-volume tables in the schema
--            (architecture.md: "explicitly meant to handle millions of
--            call/attendance rows later") - any filter/join on agent or queue
--            not already covered by the existing composite indexes currently
--            forces a table scan.
-- =============================================================================

CREATE INDEX IX_QueueIntervalCall_Agent ON [calls].QueueIntervalCall(AgentId);
GO

CREATE INDEX IX_AgentIntervalCall_Queue ON [calls].AgentIntervalCall(QueueId);
GO

CREATE INDEX IX_AttendanceSession_RecordedBy ON [attendance].AttendanceSession(RecordedByUserId);
GO
