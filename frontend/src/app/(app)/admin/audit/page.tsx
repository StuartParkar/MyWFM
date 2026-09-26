"use client";

import { useCallback } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface AuditListItem {
  auditId: number;
  entityType: string;
  entityId: string | null;
  action: string;
  performedByUserId: string | null;
  performedAt: string;
  reason: string | null;
  referenceId: string | null;
}

export default function AuditPage() {
  const { authFetch } = useAuth();

  const fetcher = useCallback(async (): Promise<AsyncResult<AuditListItem[]>> => {
    try {
      const res = await authFetch("/api/audit?limit=100");
      const body = (await res.json()) as ApiResponse<AuditListItem[]>;
      if (!res.ok || !body.success) {
        return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      }
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);

  const { data: items, error, loading, reload } = useAsyncResource(fetcher);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Audit Log</h1>
        <p className="mt-1 text-sm text-ink-muted">Who did what, when, and why - build spec section 44.</p>
      </div>

      {loading && <LoadingState label="Loading audit log" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && items?.length === 0 && (
        <EmptyState title="No audit entries yet" description="Every login, configuration change and future workflow action is recorded here as it happens." />
      )}

      {!loading && !error && items && items.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Entity</th>
                <th className="px-4 py-3 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.auditId} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{new Date(item.performedAt).toLocaleString()}</td>
                  <td className="px-4 py-3 font-medium text-ink">{item.action}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {item.entityType}
                    {item.entityId ? ` #${item.entityId}` : ""}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{item.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
