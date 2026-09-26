-- =============================================================================
-- Reference data: 0002_default_configuration
-- Real operational defaults (not demo data) the backend actually reads at
-- runtime via config.ConfigurationSetting - see backend/src/config/appConfig.ts.
-- Changing these after go-live must go through the Configuration Center
-- (Phase 12) so a new version row is created rather than this row being edited
-- in place; this script only ever inserts the initial Version = 1.
-- =============================================================================

MERGE config.ConfigurationSetting AS target
USING (VALUES
    ('business_day.timezone',            '"Asia/Kolkata"', 'STRING',  'BUSINESS_DAY', 'IANA timezone the Business Day Engine resolves business dates in. Locations observed so far (DEL, CHD) are both India.'),
    ('business_day.start_time',          '"00:00"',        'STRING',  'BUSINESS_DAY', 'Company-wide business-day start cutoff (resolveGlobalBusinessDate) - the default "00:00" makes the global business date identical to the plain calendar date.'),
    ('attendance.late_grace_minutes',       '5',            'NUMBER',  'ATTENDANCE',   'Minutes after Scheduled Start before a late first login counts as LATE_EXCEPTION.'),
    ('attendance.early_logout_grace_minutes','5',           'NUMBER',  'ATTENDANCE',   'Minutes before Scheduled End an early last logout is still tolerated before counting as EARLY_LOGOUT_EXCEPTION.'),
    ('attendance.double_shift_min_gap_hours','5',           'NUMBER',  'ATTENDANCE',   'Minimum hours required between one session''s end and the next session''s start on the same business date before DOUBLE_SHIFT_EXCEPTION is raised (build spec section 15).'),
    ('security.access_token_ttl_minutes','15',              'NUMBER',  'SECURITY',     'Access (JWT) token lifetime in minutes.'),
    ('security.refresh_token_ttl_days',  '7',               'NUMBER',  'SECURITY',     'Refresh token lifetime in days.'),
    ('security.password_min_length',     '10',              'NUMBER',  'SECURITY',     'Minimum password length enforced at registration/reset.'),
    ('security.max_failed_login_attempts','5',              'NUMBER',  'SECURITY',     'Consecutive failed logins before temporary lockout.'),
    ('security.account_lockout_minutes', '15',              'NUMBER',  'SECURITY',     'Lockout duration once max failed attempts is reached.'),
    ('calls.service_level_threshold_seconds','20',          'NUMBER',  'CALLS',        'Wait time (seconds) a call must be answered within to count toward Service Level % (build spec section 17/18) - 20s is the common call-center industry default, not this business''s own measured target yet.'),
    ('staffing.standard_shift_hours',    '9',               'NUMBER',  'STAFFING',     'Assumed productive hours per scheduled agent per day, used by Required Productive HC/Capacity/Occupancy (build spec section 19) until per-shift durations are wired into these formulas instead.'),
    ('forecast.trend_lookback_weeks',    '4',               'NUMBER',  'FORECAST',     'Weeks of trailing history compared (most recent half vs. prior half) to derive the Forecast Engine''s trend factor (build spec section 21).'),
    ('forecast.seasonality_lookback_weeks','8',              'NUMBER', 'FORECAST',     'Weeks of trailing history averaged per day-of-week to derive the Forecast Engine''s seasonality factor.'),
    ('forecast.holiday_volume_factor',   '1',               'NUMBER',  'FORECAST',     'Multiplier applied to the base forecast on a master.Holiday date. Left neutral (1 = no adjustment) until enough real multi-holiday call history exists to calibrate a real factor - a travel BPO cannot assume holidays mean lower volume the way most call centers do.')
) AS source (SettingKey, SettingValue, ValueType, Category, Description)
ON target.SettingKey = source.SettingKey AND target.Version = 1
WHEN NOT MATCHED THEN
    INSERT (SettingKey, SettingValue, ValueType, Category, Description, Version, IsActive)
    VALUES (source.SettingKey, source.SettingValue, source.ValueType, source.Category, source.Description, 1, 1);
GO
