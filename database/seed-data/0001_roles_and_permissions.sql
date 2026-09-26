-- =============================================================================
-- Reference data: 0001_roles_and_permissions
-- NOT demo data - these rows are required for the RBAC system to function at
-- all in any environment (dev, staging, production). Safe to re-run (MERGE).
--
-- Keep this file's PermissionCode list in sync with
-- shared/src/constants/permissions.ts (PERMISSION_CODES) and RoleCode list in
-- sync with shared/src/constants/roles.ts (ROLE_CODES). The backend logs a
-- WARN-level startup check if the two drift apart (see backend/src/config/
-- rbacSync.ts) - it is a warning, not a hard failure, because an ADMIN is
-- allowed to add DB-only roles/permissions ahead of a corresponding code change.
-- =============================================================================

MERGE security.Role AS target
USING (VALUES
    ('REQUESTOR', 'User / Requestor', 'Submits roster requirements and requests.'),
    ('LEADER',    'Leader / TL',      'Reviews and finalizes team-level roster requirements.'),
    ('HOD',       'Head of Department', 'Approves and finalizes department-level rosters.'),
    ('WFM',       'WFM',              'Workforce management: forecasting, staffing, publication, configuration oversight.'),
    ('ADMIN',     'Administrator',   'Full administrative access including user/role/config management.')
) AS source (RoleCode, RoleName, Description)
ON target.RoleCode = source.RoleCode
WHEN MATCHED THEN
    UPDATE SET RoleName = source.RoleName, Description = source.Description, ModifiedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (RoleCode, RoleName, Description) VALUES (source.RoleCode, source.RoleName, source.Description);
GO

MERGE security.Permission AS target
USING (VALUES
    ('user.view',           'user',   'View user accounts.'),
    ('user.manage',         'user',   'Create, edit, activate/deactivate user accounts and assign roles.'),
    ('role.manage',         'role',   'Manage roles and their permission grants.'),
    ('config.view',         'config', 'View Configuration Center settings.'),
    ('config.manage',       'config', 'Change Configuration Center settings (versioned).'),
    ('audit.view',          'audit',  'View the audit log.'),
    ('system.health.view',  'system', 'View the System Health Monitor.'),
    ('job.view',            'system', 'View background job status.'),
    ('job.manage',          'system', 'Cancel/retry background jobs.'),
    ('masterdata.view',     'masterdata', 'View employees, organization, processes, shifts, queues and skills.'),
    ('masterdata.manage',   'masterdata', 'Create/edit master data records.'),
    ('import.view',         'import', 'View import runs and their status/counts.'),
    ('import.execute',      'import', 'Upload and run imports.'),
    ('dataquality.view',    'import', 'View data-quality issues raised by imports.')
) AS source (PermissionCode, ModuleName, Description)
ON target.PermissionCode = source.PermissionCode
WHEN MATCHED THEN
    UPDATE SET ModuleName = source.ModuleName, Description = source.Description
WHEN NOT MATCHED THEN
    INSERT (PermissionCode, ModuleName, Description) VALUES (source.PermissionCode, source.ModuleName, source.Description);
GO

-- Default role -> permission matrix. REQUESTOR intentionally gets no grants
-- yet: every permission defined so far is admin/WFM/leadership-operational in
-- nature. Real REQUESTOR permissions arrive with the modules that need them
-- (roster submission, ...) in later phases.
MERGE security.RolePermission AS target
USING (
    SELECT r.RoleId, p.PermissionId
    FROM security.Role r
    CROSS JOIN security.Permission p
    WHERE r.RoleCode = 'ADMIN'

    UNION ALL

    SELECT r.RoleId, p.PermissionId
    FROM security.Role r
    JOIN security.Permission p
        ON p.PermissionCode IN (
            'user.view', 'config.view', 'audit.view', 'system.health.view', 'job.view', 'job.manage',
            'masterdata.view', 'import.view', 'import.execute', 'dataquality.view'
        )
    WHERE r.RoleCode = 'WFM'

    UNION ALL

    SELECT r.RoleId, p.PermissionId
    FROM security.Role r
    JOIN security.Permission p
        ON p.PermissionCode IN ('masterdata.view')
    WHERE r.RoleCode IN ('HOD', 'LEADER')
) AS source (RoleId, PermissionId)
ON target.RoleId = source.RoleId AND target.PermissionId = source.PermissionId
WHEN NOT MATCHED THEN
    INSERT (RoleId, PermissionId) VALUES (source.RoleId, source.PermissionId);
GO
