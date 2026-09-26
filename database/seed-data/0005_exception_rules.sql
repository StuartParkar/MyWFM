-- =============================================================================
-- Reference data: 0005_exception_rules
-- Real, adjustable-by-an-Admin-later starting thresholds for the Phase 9
-- exception engine (intraday.ExceptionRule) - not demo data, this is what
-- the engine actually evaluates against out of the box. Chosen as the
-- common, industry-standard call-center starting point for each metric
-- (20s Service Level threshold already established in Phase 7's
-- calls.service_level_threshold_seconds), not this business's own measured
-- target yet - see documentation/intraday.md.
-- =============================================================================

MERGE [intraday].ExceptionRule AS target
USING (VALUES
    ('STAFFING_GAP_BREACH',    'STAFFING',      'A process/interval''s Staffing Gap (Scheduled HC - Required HC) falls below this many agents.', '<',  -2),
    ('SERVICE_LEVEL_BREACH',   'SERVICE_LEVEL', 'A process/interval''s Service Level % falls below this percentage.',                              '<',  80),
    ('ATTENDANCE_LATE',        'ATTENDANCE',    'An employee''s late-login minutes (build spec section 15) exceed this many minutes.',              '>',  15),
    ('DATA_QUALITY_HIGH_SEVERITY', 'DATA_QUALITY', 'An import run''s open HIGH-severity data-quality issue count exceeds this many.',               '>',  0)
) AS source (RuleCode, Category, Description, ComparisonOperator, ThresholdValue)
ON target.RuleCode = source.RuleCode
WHEN NOT MATCHED THEN
    INSERT (RuleCode, Category, Description, ComparisonOperator, ThresholdValue)
    VALUES (source.RuleCode, source.Category, source.Description, source.ComparisonOperator, source.ThresholdValue);
GO
