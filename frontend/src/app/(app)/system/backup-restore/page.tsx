"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface BackupManifest {
  createdAtUtc: string;
  gitCommit: string;
  migrationFileCount: number;
  sqlServerBakIncluded: boolean;
}

interface BackupRun {
  jobId: number;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  result: { outDir: string; manifest: BackupManifest; logTail: string } | null;
}

const STATUS_TONE: Record<BackupRun["status"], BadgeTone> = {
  QUEUED: "neutral",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "critical",
  CANCELLED: "neutral",
};

export default function BackupRestorePage() {
  const { authFetch } = useAuth();
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [restoreTarget, setRestoreTarget] = useState("mywfm-restored");

  const fetcher = useCallback(async (): Promise<AsyncResult<BackupRun[]>> => {
    try {
      const res = await authFetch("/api/backup/runs");
      const body = (await res.json()) as ApiResponse<BackupRun[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);
  const { data: runs, error, loading, reload } = useAsyncResource(fetcher);

  async function handleRunBackup() {
    setTriggering(true);
    setTriggerError(null);
    const res = await authFetch("/api/backup/run", { method: "POST" });
    setTriggering(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setTriggerError(!body.success ? body.error.message : "Could not trigger a backup.");
      return;
    }
    reload();
  }

  const selectedRun = runs?.find((r) => r.jobId === selectedJobId) ?? null;
  const restoreSource = selectedRun?.result?.outDir ?? "<backup-directory-or-zip>";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Backup / Restore</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Backup is real and automated: this triggers the exact same <code>scripts/backup-mywfm.sh</code> the CLI uses
          (documentation/backup-restore.md), via the background job queue - safe to run from here because a backup is
          purely additive and never touches live state. Restore is deliberately <em>not</em> automated the same way: it
          can overwrite a live database and, per the script itself, is meant to run onto a possibly brand-new machine -
          that is guided below as the real command and steps to run yourself, not a button that acts on this system.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Backups"
          action={<Button onClick={handleRunBackup} disabled={triggering}>{triggering ? "Starting..." : "Run Backup Now"}</Button>}
        />
        <CardBody>
          {triggerError && <p className="mb-3 text-sm text-critical">{triggerError}</p>}
          {loading && <LoadingState label="Loading backup history" />}
          {!loading && error && <ErrorState message={error} onRetry={reload} />}
          {!loading && !error && runs?.length === 0 && (
            <EmptyState title="No backups yet" description="Click Run Backup Now to create the first one." />
          )}
          {!loading && !error && runs && runs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-3 font-medium">Job</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Started</th>
                    <th className="px-4 py-3 font-medium">Completed</th>
                    <th className="px-4 py-3 font-medium">Git commit</th>
                    <th className="px-4 py-3 font-medium">Migrations</th>
                    <th className="px-4 py-3 font-medium">SQL .bak</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.jobId} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 text-ink-faint">#{r.jobId}</td>
                      <td className="px-4 py-3"><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></td>
                      <td className="px-4 py-3 text-ink-muted">{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</td>
                      <td className="px-4 py-3 text-ink-muted">{r.completedAt ? new Date(r.completedAt).toLocaleString() : "—"}</td>
                      <td className="px-4 py-3 text-ink-faint">{r.result?.manifest.gitCommit.slice(0, 12) ?? (r.errorMessage ? <span className="text-critical">{r.errorMessage}</span> : "—")}</td>
                      <td className="px-4 py-3 text-ink-muted tabular-nums">{r.result?.manifest.migrationFileCount ?? "—"}</td>
                      <td className="px-4 py-3">
                        {r.result ? <Badge tone={r.result.manifest.sqlServerBakIncluded ? "success" : "neutral"}>{r.result.manifest.sqlServerBakIncluded ? "Included" : "Not included"}</Badge> : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {r.status === "COMPLETED" && (
                          <Button variant="ghost" onClick={() => setSelectedJobId(r.jobId)}>Use for restore</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Guided restore" subtitle="Build spec section 82's 10 steps - steps 1-4 are automated by the script itself, steps 5-10 need a real, reachable SQL Server and are run by an operator." />
        <CardBody className="flex flex-col gap-3">
          {selectedRun ? (
            <p className="text-sm text-ink-muted">
              Restoring <span className="font-medium text-ink">{selectedRun.result?.outDir}</span> (backup #{selectedRun.jobId}, {selectedRun.result?.manifest.createdAtUtc}).
            </p>
          ) : (
            <p className="text-sm text-ink-muted">Pick a completed backup above, or fill in a path to a backup you have elsewhere.</p>
          )}
          <Input label="Target directory" className="w-96" value={restoreTarget} onChange={(e) => setRestoreTarget(e.target.value)} />
          <div>
            <p className="mb-1 text-xs font-medium text-ink-muted">Run this on the target machine:</p>
            <pre className="overflow-x-auto rounded-md bg-canvas p-3 text-xs text-ink">scripts/restore-mywfm.sh {restoreSource} {restoreTarget || "mywfm-restored"}</pre>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
            <li>Prerequisites: node, npm, a reachable SQL Server (and unzip, if restoring from a .zip)</li>
            <li>Manifest validation (automated)</li>
            <li>Application source restored into the target directory (automated)</li>
            <li>Environment files: copy each restored <code>.env.example</code> to <code>.env</code> and fill in real values (automated copy, manual values)</li>
            <li>SQL Server setup: ensure a reachable instance exists (<code>docker compose up -d db</code>, or your own)</li>
            <li>Database restore: a live <code>.bak</code> (if one was captured) lives on the source SQL Server host, not in this archive - <code>RESTORE DATABASE ... WITH REPLACE</code>; otherwise the schema is rebuilt from migrations in the next step</li>
            <li>Migrations: <code>npm install &amp;&amp; npm run db:migrate --workspace=backend</code></li>
            <li>Backend setup: fill in <code>backend/.env</code>, then <code>npm run db:seed --workspace=backend</code></li>
            <li>Frontend setup: fill in <code>frontend/.env.local</code></li>
            <li>Startup and validation: <code>npm run dev</code>, then check <code>GET /api/system-health</code></li>
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
