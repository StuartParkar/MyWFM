-- =============================================================================
-- Reference data: 0003_designations
-- Not demo data - required lookup rows. Levels/order match the hierarchy
-- columns observed in imports/samples/master-data/ (SME -> Team Leader -> AM
-- -> Manager -> Sr. Manager -> Unit HOD), plus the base "Agent" level that
-- has no dedicated source column (anyone never referenced as someone else's
-- leader). See backend/src/scripts/importOrgHierarchy.ts for how an
-- employee's DesignationId is derived from this.
-- =============================================================================

MERGE [master].Designation AS target
USING (VALUES
    ('AGENT',       'Agent',                  0),
    ('SME',         'Subject Matter Expert',  1),
    ('TEAM_LEADER', 'Team Leader',            2),
    ('AM',          'Assistant Manager',      3),
    ('MANAGER',     'Manager',                4),
    ('SR_MANAGER',  'Senior Manager',         5),
    ('UNIT_HOD',    'Unit HOD',               6)
) AS source (DesignationCode, DesignationName, HierarchyLevel)
ON target.DesignationCode = source.DesignationCode
WHEN MATCHED THEN
    UPDATE SET DesignationName = source.DesignationName, HierarchyLevel = source.HierarchyLevel
WHEN NOT MATCHED THEN
    INSERT (DesignationCode, DesignationName, HierarchyLevel)
    VALUES (source.DesignationCode, source.DesignationName, source.HierarchyLevel);
GO
