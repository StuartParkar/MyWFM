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
    ('ACTUAL_STAFFING_GAP', 1, 'Actual Staffing Gap', 'Present HC - Required HC, where Present HC comes from recorded attendance sessions (build spec section 19).', 'STAFFING', '2026-01-01'),
    ('OFFERED_CALLS', 1, 'Offered Calls', 'Count of queue-grain calls.QueueIntervalCall rows (build spec section 17).', 'CALLS', '2026-01-01'),
    ('ANSWERED_CALLS', 1, 'Answered Calls', 'Count of offered calls with Disposition = ANSWERED (build spec section 17).', 'CALLS', '2026-01-01'),
    ('ABANDONED_CALLS', 1, 'Abandoned Calls', 'Count of offered calls with Disposition = ABANDONED (build spec section 17).', 'CALLS', '2026-01-01'),
    ('ANSWER_RATE_PCT', 1, 'Answer Rate %', 'Answered Calls / Offered Calls x 100 (build spec section 17).', 'CALLS', '2026-01-01'),
    ('ABANDON_RATE_PCT', 1, 'Abandon Rate %', 'Abandoned Calls / Offered Calls x 100 (build spec section 17).', 'CALLS', '2026-01-01'),
    ('AHT_SECONDS', 1, 'Average Handle Time (seconds)', 'Mean of each answered call''s HandleSeconds (or TalkSeconds+HoldSeconds+ACWSeconds where HandleSeconds is not reported) (build spec section 18).', 'CALLS', '2026-01-01'),
    ('SERVICE_LEVEL_PCT', 1, 'Service Level %', 'Calls answered within calls.service_level_threshold_seconds / Offered Calls x 100 (build spec section 18).', 'CALLS', '2026-01-01'),
    ('WORKLOAD_HOURS', 1, 'Workload (agent-hours)', 'Offered Calls x AHT Seconds / 3600 (build spec section 19) - the agent-hours needed to handle a day''s call volume.', 'CALLS', '2026-01-01'),
    ('REQUIRED_PRODUCTIVE_HC', 1, 'Required Productive HC', 'Workload Hours / (staffing.standard_shift_hours x (1 - Shrinkage %)) (build spec section 19).', 'STAFFING', '2026-01-01'),
    ('CAPACITY_HOURS', 1, 'Capacity (productive agent-hours)', 'Scheduled HC x staffing.standard_shift_hours x (1 - Shrinkage %) (build spec section 19) - the productive hours the published roster actually makes available.', 'STAFFING', '2026-01-01'),
    ('CAPACITY_UTILIZATION_PCT', 1, 'Capacity Utilization %', 'Workload Hours / Capacity Hours x 100 (build spec section 19).', 'STAFFING', '2026-01-01'),
    ('OCCUPANCY_PCT', 1, 'Occupancy %', 'Workload Hours / (Present HC x staffing.standard_shift_hours) x 100 (build spec section 18) - share of present agents'' time actually spent handling calls.', 'STAFFING', '2026-01-01'),
    ('CALL_VOLUME_FORECAST', 1, 'Call Volume Forecast', 'Base Forecast x Trend Factor x Seasonality Factor x Holiday Factor (build spec section 21) - see documentation/formulas.md for how each factor is derived from historical Offered Calls.', 'FORECAST', '2026-01-01'),
    ('FORECAST_MAE', 1, 'Forecast Mean Absolute Error', 'Mean(|Forecast - Actual Offered Calls|) over a date range (build spec section 21).', 'FORECAST', '2026-01-01'),
    ('FORECAST_MAPE', 1, 'Forecast Mean Absolute Percentage Error', 'Mean(|Forecast - Actual| / Actual) x 100 over a date range, actual-is-zero days excluded (build spec section 21).', 'FORECAST', '2026-01-01'),
    ('FORECAST_BIAS', 1, 'Forecast Bias', 'Mean(Forecast - Actual) over a date range - positive means the engine over-forecasts (build spec section 21).', 'FORECAST', '2026-01-01'),
    ('ATTENDANCE_PCT', 1, 'Attendance %', 'Present HC / Planned HC x 100, company-wide over a date range (Control Tower) - see documentation/controltower.md.', 'ATTENDANCE', '2026-01-01'),
    ('AVAILABLE_STAFFING_GAP', 1, 'Available Staffing Gap', 'Available HC - Required HC, where Available HC is Present HC minus whoever is currently on a recorded break (build spec section 20''s Break Management) - distinct from Staffing Gap (vs. Scheduled HC) and Actual Staffing Gap (vs. Present HC, break-blind).', 'INTRADAY', '2026-01-01'),
    ('ATTRITION_RATE_PCT', 1, 'Attrition Rate %', 'Exits / ((Opening HC + Closing HC) / 2) x 100 over a date range (build spec section 22) - Opening/Closing HC, Joiners and Exits come from master.Employee.JoinDate/LeftDate (system-observed or manually entered - see documentation/attrition.md), never derived from missing HR data.', 'ATTRITION', '2026-01-01')
) AS source (FormulaCode, Version, Name, Description, Category, EffectiveFrom)
ON target.FormulaCode = source.FormulaCode AND target.Version = source.Version
WHEN NOT MATCHED THEN
    INSERT (FormulaCode, Version, Name, Description, Category, EffectiveFrom)
    VALUES (source.FormulaCode, source.Version, source.Name, source.Description, source.Category, source.EffectiveFrom);
GO
