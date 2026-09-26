-- =============================================================================
-- Migration: 0001_security_foundation
-- Purpose:   Roles, permissions, users, refresh tokens and the generic audit log.
--            This is the security/audit foundation every later phase depends on.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'security')
    EXEC('CREATE SCHEMA security');
GO

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'audit')
    EXEC('CREATE SCHEMA audit');
GO

-- -----------------------------------------------------------------------------
-- security.Role
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'security' AND t.name = 'Role')
BEGIN
    CREATE TABLE security.Role
    (
        RoleId          INT             NOT NULL IDENTITY(1,1) CONSTRAINT PK_Role PRIMARY KEY,
        RoleCode        VARCHAR(20)     NOT NULL,
        RoleName        NVARCHAR(100)   NOT NULL,
        Description     NVARCHAR(400)   NULL,
        IsActive        BIT             NOT NULL CONSTRAINT DF_Role_IsActive DEFAULT (1),
        CreatedAt       DATETIME2(3)    NOT NULL CONSTRAINT DF_Role_CreatedAt DEFAULT (SYSUTCDATETIME()),
        ModifiedAt      DATETIME2(3)    NOT NULL CONSTRAINT DF_Role_ModifiedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT UQ_Role_RoleCode UNIQUE (RoleCode)
    );
END
GO

-- -----------------------------------------------------------------------------
-- security.Permission
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'security' AND t.name = 'Permission')
BEGIN
    CREATE TABLE security.Permission
    (
        PermissionId    INT             NOT NULL IDENTITY(1,1) CONSTRAINT PK_Permission PRIMARY KEY,
        PermissionCode  VARCHAR(60)     NOT NULL,
        ModuleName      VARCHAR(60)     NOT NULL,
        Description     NVARCHAR(400)   NULL,
        CreatedAt       DATETIME2(3)    NOT NULL CONSTRAINT DF_Permission_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT UQ_Permission_PermissionCode UNIQUE (PermissionCode)
    );
END
GO

-- -----------------------------------------------------------------------------
-- security.RolePermission (many-to-many)
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'security' AND t.name = 'RolePermission')
BEGIN
    CREATE TABLE security.RolePermission
    (
        RoleId          INT NOT NULL CONSTRAINT FK_RolePermission_Role REFERENCES security.Role(RoleId),
        PermissionId    INT NOT NULL CONSTRAINT FK_RolePermission_Permission REFERENCES security.Permission(PermissionId),
        GrantedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_RolePermission_GrantedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_RolePermission PRIMARY KEY (RoleId, PermissionId)
    );
END
GO

-- -----------------------------------------------------------------------------
-- security.[User]
-- Note: no FK to an Employee table yet - master.Employee does not exist until
-- Phase 2. A nullable EmployeeId link will be added by a Phase 2 migration via
-- ALTER TABLE once that table's key shape is known, instead of guessing it now.
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'security' AND t.name = 'User')
BEGIN
    CREATE TABLE security.[User]
    (
        UserId              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_User PRIMARY KEY CONSTRAINT DF_User_UserId DEFAULT (NEWSEQUENTIALID()),
        Email               NVARCHAR(256)    NOT NULL,
        PasswordHash        NVARCHAR(200)    NOT NULL,
        DisplayName         NVARCHAR(200)    NOT NULL,
        IsActive            BIT              NOT NULL CONSTRAINT DF_User_IsActive DEFAULT (1),
        FailedLoginAttempts INT              NOT NULL CONSTRAINT DF_User_FailedLoginAttempts DEFAULT (0),
        LockedUntil         DATETIME2(3)     NULL,
        LastLoginAt         DATETIME2(3)     NULL,
        CreatedAt           DATETIME2(3)     NOT NULL CONSTRAINT DF_User_CreatedAt DEFAULT (SYSUTCDATETIME()),
        ModifiedAt          DATETIME2(3)     NOT NULL CONSTRAINT DF_User_ModifiedAt DEFAULT (SYSUTCDATETIME()),
        -- Application always normalizes email to lowercase before write/read as
        -- defense in depth, regardless of the database's collation.
        CONSTRAINT UQ_User_Email UNIQUE (Email)
    );
END
GO

-- -----------------------------------------------------------------------------
-- security.UserRole (many-to-many)
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'security' AND t.name = 'UserRole')
BEGIN
    CREATE TABLE security.UserRole
    (
        UserId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_UserRole_User REFERENCES security.[User](UserId),
        RoleId      INT              NOT NULL CONSTRAINT FK_UserRole_Role REFERENCES security.Role(RoleId),
        AssignedAt  DATETIME2(3)     NOT NULL CONSTRAINT DF_UserRole_AssignedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_UserRole PRIMARY KEY (UserId, RoleId)
    );
END
GO

-- -----------------------------------------------------------------------------
-- security.RefreshToken - opaque refresh tokens are hashed at rest; only the
-- hash is ever stored, matching standard rotation-with-reuse-detection practice.
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'security' AND t.name = 'RefreshToken')
BEGIN
    CREATE TABLE security.RefreshToken
    (
        RefreshTokenId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_RefreshToken PRIMARY KEY CONSTRAINT DF_RefreshToken_Id DEFAULT (NEWSEQUENTIALID()),
        UserId              UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_RefreshToken_User REFERENCES security.[User](UserId),
        TokenHash           CHAR(64)         NOT NULL, -- SHA-256 hex digest of the raw token
        IssuedAt            DATETIME2(3)     NOT NULL CONSTRAINT DF_RefreshToken_IssuedAt DEFAULT (SYSUTCDATETIME()),
        ExpiresAt           DATETIME2(3)     NOT NULL,
        RevokedAt           DATETIME2(3)     NULL,
        ReplacedByTokenId   UNIQUEIDENTIFIER NULL,
        CreatedByIp         VARCHAR(64)      NULL,
        UserAgent           NVARCHAR(400)    NULL,
        CONSTRAINT UQ_RefreshToken_TokenHash UNIQUE (TokenHash)
    );
    CREATE INDEX IX_RefreshToken_UserId ON security.RefreshToken(UserId) INCLUDE (ExpiresAt, RevokedAt);
END
GO

-- -----------------------------------------------------------------------------
-- audit.AuditLog - generic "who/what/when/where/before/after/reason/reference"
-- sink used by every module (build spec section 44). Written explicitly by
-- application services (auth, config, roster, ...) rather than by DB triggers,
-- so it can capture request-level context (reason, IP, correlation id) that a
-- trigger cannot see.
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'audit' AND t.name = 'AuditLog')
BEGIN
    CREATE TABLE audit.AuditLog
    (
        AuditId             BIGINT           NOT NULL IDENTITY(1,1) CONSTRAINT PK_AuditLog PRIMARY KEY,
        EntityType          VARCHAR(100)     NOT NULL,
        EntityId            VARCHAR(100)     NULL,
        Action              VARCHAR(60)      NOT NULL,
        PerformedByUserId   UNIQUEIDENTIFIER NULL CONSTRAINT FK_AuditLog_User REFERENCES security.[User](UserId),
        PerformedAt         DATETIME2(3)     NOT NULL CONSTRAINT DF_AuditLog_PerformedAt DEFAULT (SYSUTCDATETIME()),
        BeforeValue         NVARCHAR(MAX)    NULL, -- JSON
        AfterValue          NVARCHAR(MAX)    NULL, -- JSON
        Reason              NVARCHAR(500)    NULL,
        ReferenceId         VARCHAR(100)     NULL,
        IpAddress           VARCHAR(64)      NULL,
        CorrelationId       UNIQUEIDENTIFIER NULL
    );
    CREATE INDEX IX_AuditLog_Entity ON audit.AuditLog(EntityType, EntityId);
    CREATE INDEX IX_AuditLog_PerformedBy ON audit.AuditLog(PerformedByUserId);
    CREATE INDEX IX_AuditLog_PerformedAt ON audit.AuditLog(PerformedAt);
END
GO
