-- =============================================================================
-- Procedure: security.usp_GetUserAuthProfile
-- Purpose:   Single round-trip fetch of everything the auth flow needs: the
--            user row, their roles, and the flattened set of permission codes
--            granted by those roles. Used on the hot path (every login and
--            every access-token refresh), so it is a stored procedure rather
--            than several separate ORM-style queries.
--
--            Accepts either @Email (login, where only the email is known) or
--            @UserId (token refresh, where the caller already resolved the
--            user via their refresh token) - exactly one must be supplied.
--
-- Result sets: 1) user core row  2) RoleCode per assigned role
--              3) distinct PermissionCode granted via those roles
-- =============================================================================
CREATE OR ALTER PROCEDURE security.usp_GetUserAuthProfile
    @Email  NVARCHAR(256)     = NULL,
    @UserId UNIQUEIDENTIFIER  = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @Email IS NULL AND @UserId IS NULL
    BEGIN
        THROW 50000, 'usp_GetUserAuthProfile requires either @Email or @UserId.', 1;
    END

    IF @UserId IS NULL
    BEGIN
        SELECT @UserId = UserId FROM security.[User] WHERE Email = @Email;
    END

    SELECT
        UserId,
        Email,
        PasswordHash,
        DisplayName,
        IsActive,
        FailedLoginAttempts,
        LockedUntil
    FROM security.[User]
    WHERE UserId = @UserId;

    SELECT r.RoleCode
    FROM security.UserRole ur
    JOIN security.Role r ON r.RoleId = ur.RoleId
    WHERE ur.UserId = @UserId
      AND r.IsActive = 1;

    SELECT DISTINCT p.PermissionCode
    FROM security.UserRole ur
    JOIN security.RolePermission rp ON rp.RoleId = ur.RoleId
    JOIN security.Permission p ON p.PermissionId = rp.PermissionId
    JOIN security.Role r ON r.RoleId = ur.RoleId
    WHERE ur.UserId = @UserId
      AND r.IsActive = 1;
END
GO
