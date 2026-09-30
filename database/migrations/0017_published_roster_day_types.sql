-- =============================================================================
-- Migration: 0017_published_roster_day_types
-- Purpose:   roster.PublishedRoster can currently only represent a normal
--            shift (ShiftId set, IsWeeklyOff = 0) or a weekly off (ShiftId
--            NULL, IsWeeklyOff = 1). The first real roster import (India
--            Team Roster, Sep/Oct 2026) has day-cells for Leave ("L"), Extra
--            Head ("EH") and Festival Off ("FO") that fit neither. Adds one
--            additive, nullable column rather than touching IsWeeklyOff's
--            existing meaning - every current reader of IsWeeklyOff/ShiftId
--            (staffing, attendance, shrinkage, intraday, Control Tower)
--            keeps working unchanged, since an ordinary shift day and a
--            weekly-off day both continue to leave DayType NULL exactly as
--            before. WO/L/EH/FO days are written directly to this table with
--            RosterRequirementId NULL (no requirement/approval - there is no
--            "required headcount" for a day off) - see documentation/imports.md
--            ("Roster... populated by direct data entry", not the Import
--            Center pipeline).
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('roster.PublishedRoster') AND name = 'DayType')
BEGIN
    ALTER TABLE [roster].PublishedRoster ADD DayType VARCHAR(20) NULL
        CONSTRAINT CK_PublishedRoster_DayType CHECK (DayType IN ('LEAVE', 'EXTRA_HEAD', 'FESTIVAL_OFF'));
END
GO

-- A column-level CHECK cannot reference another column in SQL Server (error
-- 8141 - this codebase already hit exactly this in migrations 0008 and 0013,
-- see documentation/troubleshooting.md). This guard is therefore its own
-- table-level constraint, not attached to DayType's own definition above.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PublishedRoster_DayType_NotWeeklyOff')
BEGIN
    ALTER TABLE [roster].PublishedRoster ADD CONSTRAINT CK_PublishedRoster_DayType_NotWeeklyOff
        CHECK (NOT (IsWeeklyOff = 1 AND DayType IS NOT NULL));
END
GO
