"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult, RoleCode } from "@mywfm/shared";
import { ROLE_LABELS } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState, LoadingState } from "@/components/ui/States";

interface UserListItem {
  userId: string;
  email: string;
  displayName: string;
  isActive: boolean;
  roles: RoleCode[];
  lastLoginAt: string | null;
}

const ALL_ROLES: RoleCode[] = ["REQUESTOR", "LEADER", "HOD", "WFM", "ADMIN"];

export default function UsersRolesPage() {
  const { authFetch } = useAuth();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<UserListItem>>> => {
    try {
      const res = await authFetch("/api/users?pageSize=100");
      const body = (await res.json()) as ApiResponse<PaginatedResult<UserListItem>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);

  const { data: result, error, loading, reload } = useAsyncResource(fetcher);

  async function toggleRole(user: UserListItem, role: RoleCode) {
    setBusyUserId(user.userId);
    const nextRoles = user.roles.includes(role) ? user.roles.filter((r) => r !== role) : [...user.roles, role];
    if (nextRoles.length === 0) {
      setBusyUserId(null);
      return; // a user must keep at least one role
    }
    await authFetch(`/api/users/${user.userId}/roles`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleCodes: nextRoles }),
    });
    setBusyUserId(null);
    reload();
  }

  async function toggleActive(user: UserListItem) {
    setBusyUserId(user.userId);
    await authFetch(`/api/users/${user.userId}/active`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !user.isActive }),
    });
    setBusyUserId(null);
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Users &amp; Roles</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Login accounts and their RBAC role grants. New accounts are created with{" "}
          <code className="rounded bg-canvas px-1 py-0.5 text-xs">npm run create-admin --workspace=backend</code> or by an ADMIN
          via the API - see documentation/security.md.
        </p>
      </div>

      {loading && <LoadingState label="Loading users" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && result && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Roles</th>
                <th className="px-4 py-3 font-medium">Last Login</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {result.items.map((user) => (
                <tr key={user.userId} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <div className="text-ink">{user.displayName}</div>
                    <div className="text-xs text-ink-faint">{user.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_ROLES.map((role) => (
                        <button
                          key={role}
                          type="button"
                          disabled={busyUserId === user.userId}
                          onClick={() => toggleRole(user, role)}
                          className="disabled:opacity-50"
                          title={user.roles.includes(role) ? `Remove ${ROLE_LABELS[role]}` : `Grant ${ROLE_LABELS[role]}`}
                        >
                          <Badge tone={user.roles.includes(role) ? "info" : "neutral"}>{ROLE_LABELS[role]}</Badge>
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={user.isActive ? "success" : "critical"}>{user.isActive ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="secondary" disabled={busyUserId === user.userId} onClick={() => toggleActive(user)}>
                      {user.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
