"use client";

import { useCallback, useState } from "react";
import type { ApiResponse, PaginatedResult } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface RequirementRow {
  RosterRequirementId: number;
  BusinessDate: string;
  DepartmentName: string | null;
  ShiftCode: string | null;
  RequiredHC: number;
  Status: string;
}

const STATUS_TONE: Record<string, BadgeTone> = { SUBMITTED: "neutral", HOD_REVIEW: "info", WFM_REVIEW: "info" };
const PENDING_STATUSES = ["SUBMITTED", "HOD_REVIEW", "WFM_REVIEW"];

function ReviewRow({ requirement, onChanged }: { requirement: RequirementRow; onChanged: () => void }) {
  const { authFetch } = useAuth();
  const [employeeCode, setEmployeeCode] = useState("");
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function decide(decision: "APPROVE" | "REJECT" | "SEND_BACK") {
    setBusy(true);
    setRowError(null);
    const res = await authFetch(`/api/roster/requirements/${requirement.RosterRequirementId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, comments: comments || null }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setRowError(!body.success ? body.error.message : "Could not record decision.");
      return;
    }
    onChanged();
  }

  async function addAssignment() {
    if (!employeeCode.trim()) return;
    setBusy(true);
    setRowError(null);
    const lookupRes = await authFetch(`/api/master-data/employees?search=${encodeURIComponent(employeeCode)}&pageSize=1`);
    const lookupBody = (await lookupRes.json()) as ApiResponse<{ items: { employeeId: string }[] }>;
    const employeeId = lookupBody.success ? lookupBody.data.items[0]?.employeeId : undefined;
    if (!employeeId) {
      setBusy(false);
      setRowError(`No employee matches "${employeeCode}".`);
      return;
    }
    const res = await authFetch(`/api/roster/requirements/${requirement.RosterRequirementId}/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setRowError(!body.success ? body.error.message : "Could not assign employee.");
      return;
    }
    setEmployeeCode("");
    onChanged();
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-ink">{requirement.BusinessDate}</span>
            <span className="ml-2 text-ink-muted">{requirement.DepartmentName ?? "—"} · {requirement.ShiftCode ?? "—"} · Required HC {requirement.RequiredHC}</span>
          </div>
          <Badge tone={STATUS_TONE[requirement.Status] ?? "neutral"}>{requirement.Status}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Employee code to assign"
            className="w-48"
            value={employeeCode}
            onChange={(e) => setEmployeeCode(e.target.value)}
          />
          <Button variant="secondary" disabled={busy} onClick={addAssignment}>Assign</Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Comments (optional)"
            className="min-w-48 flex-1"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
          <Button disabled={busy} onClick={() => decide("APPROVE")}>Approve</Button>
          <Button variant="secondary" disabled={busy} onClick={() => decide("SEND_BACK")}>Send back</Button>
          <Button variant="danger" disabled={busy} onClick={() => decide("REJECT")}>Reject</Button>
        </div>
        {rowError && <p className="text-sm text-critical">{rowError}</p>}
      </CardBody>
    </Card>
  );
}

export default function RosterReviewPage() {
  const { authFetch } = useAuth();

  const fetcher = useCallback(async (): Promise<AsyncResult<RequirementRow[]>> => {
    try {
      const results = await Promise.all(
        PENDING_STATUSES.map((status) => authFetch(`/api/roster/requirements?status=${status}&pageSize=50`)),
      );
      const bodies = (await Promise.all(results.map((r) => r.json()))) as ApiResponse<PaginatedResult<RequirementRow>>[];
      const items = bodies.flatMap((b) => (b.success ? b.data.items : []));
      if (bodies.some((b) => !b.success)) return { ok: false, message: "Could not load some review queues." };
      return { ok: true, data: items };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);

  const { data: items, error, loading, reload } = useAsyncResource(fetcher);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Roster Review</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Everything awaiting a decision. The backend enforces which stage you can act on - approving/rejecting a
          requirement not at your stage is refused server-side.
        </p>
      </div>

      {loading && <LoadingState label="Loading review queue" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && items?.length === 0 && <EmptyState title="Nothing pending review" description="Every submitted requirement has been decided." />}
      {!loading && !error && items && items.length > 0 && (
        <div className="flex flex-col gap-3">
          {items.map((r) => (
            <ReviewRow key={r.RosterRequirementId} requirement={r} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}
