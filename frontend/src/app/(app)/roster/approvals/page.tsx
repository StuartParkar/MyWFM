"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";
import { cn } from "@/lib/cn";

interface RequirementRow {
  RosterRequirementId: number;
  BusinessDate: string;
  DepartmentName: string | null;
  ProcessName: string | null;
  ShiftCode: string | null;
  RequiredHC: number;
  Status: string;
  RequestedByName: string | null;
}

interface ActionRow {
  action: string;
  fromStatus: string;
  toStatus: string;
  performedByName: string | null;
  comments: string | null;
  performedAt: string;
}

interface AssignmentRow {
  employeeId: string;
  fullName: string;
  employeeCode: string;
}

interface RequirementDetail {
  requirement: RequirementRow | null;
  actions: ActionRow[];
  assignments: AssignmentRow[];
}

const STATUS_TONE: Record<string, BadgeTone> = {
  SUBMITTED: "neutral",
  HOD_REVIEW: "info",
  WFM_REVIEW: "info",
  PUBLISHED: "success",
  REJECTED: "critical",
};

const STATUS_OPTIONS = ["", "SUBMITTED", "HOD_REVIEW", "WFM_REVIEW", "PUBLISHED", "REJECTED"];

export default function RosterApprovalsPage() {
  const { authFetch } = useAuth();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const listFetcher = useCallback(async (): Promise<AsyncResult<PaginatedResult<RequirementRow>>> => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (status) params.set("status", status);
      const res = await authFetch(`/api/roster/requirements?${params}`);
      const body = (await res.json()) as ApiResponse<PaginatedResult<RequirementRow>>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, status, page]);

  const { data: result, error, loading, reload } = useAsyncResource(listFetcher, [status, page]);

  const detailFetcher = useCallback(async (): Promise<AsyncResult<RequirementDetail | null>> => {
    if (selectedId == null) return { ok: true, data: null };
    try {
      const res = await authFetch(`/api/roster/requirements/${selectedId}`);
      const body = (await res.json()) as ApiResponse<RequirementDetail>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, selectedId]);

  const { data: detail, error: detailError, loading: detailLoading } = useAsyncResource(detailFetcher, [selectedId]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink">Roster Approvals</h1>
          <p className="mt-1 text-sm text-ink-muted">
            The Requestor -&gt; Leader -&gt; HOD -&gt; WFM approval chain for every requirement. Select a row to see its
            full decision history.
          </p>
        </div>
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
            setSelectedId(null);
          }}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s || "all"} value={s}>
              {s || "All statuses"}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          {loading && <LoadingState label="Loading requirements" />}
          {!loading && error && <ErrorState message={error} onRetry={reload} />}
          {!loading && !error && result?.items.length === 0 && <EmptyState title="No requirements" description="Nothing matches this filter." />}
          {!loading && !error && result && result.items.length > 0 && (
            <>
              <Card className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Department / Shift</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((r) => (
                      <tr
                        key={r.RosterRequirementId}
                        onClick={() => setSelectedId(r.RosterRequirementId)}
                        className={cn(
                          "cursor-pointer border-b border-line last:border-0 hover:bg-canvas",
                          selectedId === r.RosterRequirementId && "bg-accent-soft",
                        )}
                      >
                        <td className="px-4 py-3 text-ink">{r.BusinessDate}</td>
                        <td className="px-4 py-3 text-ink-muted">{[r.DepartmentName, r.ShiftCode].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="px-4 py-3">
                          <Badge tone={STATUS_TONE[r.Status] ?? "neutral"}>{r.Status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <div className="flex items-center justify-between text-sm text-ink-muted">
                <span>
                  Page {result.page} of {result.totalPages} · {result.totalItems} requirements
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="secondary" disabled={page >= result.totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        <div>
          {selectedId == null && (
            <EmptyState title="Nothing selected" description="Select a requirement on the left to see its approval history." />
          )}
          {selectedId != null && detailLoading && <LoadingState label="Loading history" />}
          {selectedId != null && !detailLoading && detailError && <ErrorState message={detailError} />}
          {selectedId != null && !detailLoading && !detailError && detail && !detail.requirement && (
            <EmptyState title="Not found" description="This requirement could not be loaded." />
          )}
          {selectedId != null && !detailLoading && !detailError && detail?.requirement && (
            <Card>
              <CardHeader
                title={`${detail.requirement.BusinessDate} · Required HC ${detail.requirement.RequiredHC}`}
                subtitle={[detail.requirement.DepartmentName, detail.requirement.ProcessName, detail.requirement.ShiftCode].filter(Boolean).join(" · ") || undefined}
                action={<Badge tone={STATUS_TONE[detail.requirement.Status] ?? "neutral"}>{detail.requirement.Status}</Badge>}
              />
              <CardBody className="flex flex-col gap-4">
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-ink-faint">Assigned employees</h3>
                  {detail.assignments.length === 0 ? (
                    <p className="mt-1 text-sm text-ink-muted">No employees assigned yet.</p>
                  ) : (
                    <ul className="mt-1 flex flex-col gap-1 text-sm text-ink-muted">
                      {detail.assignments.map((a) => (
                        <li key={a.employeeId}>
                          {a.fullName} <span className="text-ink-faint">#{a.employeeCode}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-ink-faint">History</h3>
                  {detail.actions.length === 0 ? (
                    <p className="mt-1 text-sm text-ink-muted">No actions recorded yet.</p>
                  ) : (
                    <ol className="mt-1 flex flex-col gap-2 text-sm">
                      {detail.actions.map((a, i) => (
                        <li key={i} className="border-l-2 border-line-strong pl-3">
                          <div className="text-ink">
                            {a.action}: {a.fromStatus} → {a.toStatus}
                          </div>
                          <div className="text-xs text-ink-faint">
                            {a.performedByName ?? "—"} · {new Date(a.performedAt).toLocaleString()}
                          </div>
                          {a.comments && <div className="mt-0.5 text-xs text-ink-muted">&quot;{a.comments}&quot;</div>}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
