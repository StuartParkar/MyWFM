-- =============================================================================
-- Reference data: 0004_shrinkage_and_formulas
-- The shrinkage category list is the exact set build spec section 20 names -
-- real reference data, not invented demo data (same status as the roles and
-- permissions in 0001). Formula definitions are the Formula Library's
-- browsable catalog entries for section 7's real, code-implemented formulas
-- (see documentation/formulas.md) - metadata only, never an executable
-- expression (build spec section 2: formulas are reviewed TypeScript, not a
-- runtime-evaluated string).
-- =============================================================================

MERGE [shrinkage].ShrinkageCategory AS target
USING (VALUES
    ('PLANNED_LEAVE',   'Planned Leave'),
    ('UNPLANNED_LEAVE', 'Unplanned Leave'),
    ('TRAINING',        'Training'),
    ('MEETING',         'Meeting'),
    ('COACHING',        'Coaching'),
    ('SYSTEM_DOWNTIME', 'System Downtime'),
    ('BREAK',           'Break'),
    ('OTHER',           'Other')
) AS source (CategoryCode, CategoryName)
ON target.CategoryCode = source.CategoryCode
WHEN MATCHED THEN
    UPDATE SET CategoryName = source.CategoryName
WHEN NOT MATCHED THEN
    INSERT (CategoryCode, CategoryName) VALUES (source.CategoryCode, source.CategoryName);
GO

MERGE [formula].FormulaDefinition AS target
USING (VALUES
    ('SHRINKAGE_PCT', 1, 'Shrinkage %', 'Unavailable Minutes / Scheduled Minutes x 100 (build spec section 20), by category and in total.', 'SHRINKAGE', '2026-01-01'),
    ('ROSTER_COVERAGE_PCT', 1, 'Roster Coverage %', 'Scheduled HC / Required HC x 100, against the roster requirement''s own Required HC (build spec section 19).', 'STAFFING', '2026-01-01'),
    ('STAFFING_GAP', 1, 'Staffing Gap', 'Scheduled HC - Required HC (build spec section 19).', 'STAFFING', '2026-01-01'),
    ('ACTUAL_STAFFING_GAP', 1, 'Actual Staffing Gap', 'Present HC - Required HC, where Present HC comes from recorded attendance sessions (build spec section 19).', 'STAFFING', '2026-01-01')
) AS source (FormulaCode, Version, Name, Description, Category, EffectiveFrom)
ON target.FormulaCode = source.FormulaCode AND target.Version = source.Version
WHEN NOT MATCHED THEN
    INSERT (FormulaCode, Version, Name, Description, Category, EffectiveFrom)
    VALUES (source.FormulaCode, source.Version, source.Name, source.Description, source.Category, source.EffectiveFrom);
GO
