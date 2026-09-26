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
    ('business_day.start_time',          '"00:00"',        'STRING',  'BUSINESS_DAY', 'Calendar-day start placeholder used until the Phase 5 shift-aware Business Day Engine replaces it.'),
    ('security.access_token_ttl_minutes','15',              'NUMBER',  'SECURITY',     'Access (JWT) token lifetime in minutes.'),
    ('security.refresh_token_ttl_days',  '7',               'NUMBER',  'SECURITY',     'Refresh token lifetime in days.'),
    ('security.password_min_length',     '10',              'NUMBER',  'SECURITY',     'Minimum password length enforced at registration/reset.'),
    ('security.max_failed_login_attempts','5',              'NUMBER',  'SECURITY',     'Consecutive failed logins before temporary lockout.'),
    ('security.account_lockout_minutes', '15',              'NUMBER',  'SECURITY',     'Lockout duration once max failed attempts is reached.')
) AS source (SettingKey, SettingValue, ValueType, Category, Description)
ON target.SettingKey = source.SettingKey AND target.Version = 1
WHEN NOT MATCHED THEN
    INSERT (SettingKey, SettingValue, ValueType, Category, Description, Version, IsActive)
    VALUES (source.SettingKey, source.SettingValue, source.ValueType, source.Category, source.Description, 1, 1);
GO
