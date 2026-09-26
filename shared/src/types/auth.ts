import type { RoleCode } from "../constants/roles.js";
import type { PermissionCode } from "../constants/permissions.js";

export interface AuthenticatedUser {
  userId: string;
  email: string;
  displayName: string;
  roles: RoleCode[];
  permissions: PermissionCode[];
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  user: AuthenticatedUser;
}

export interface AccessTokenClaims {
  sub: string;
  email: string;
  displayName: string;
  roles: RoleCode[];
  permissions: PermissionCode[];
  iat: number;
  exp: number;
}
