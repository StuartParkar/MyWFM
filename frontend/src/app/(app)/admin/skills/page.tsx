"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface SkillRow {
  id: number;
  code: string;
  name: string;
}

export default function SkillsPage() {
  const { authFetch } = useAuth();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<AsyncResult<SkillRow[]>> => {
    try {
      const res = await authFetch("/api/master-data/skills");
      const body = (await res.json()) as ApiResponse<SkillRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);

  const { data: skills, error, loading, reload } = useAsyncResource(fetcher);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const res = await authFetch("/api/master-data/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setFormError(!body.success ? body.error.message : "Could not add skill.");
      return;
    }
    setCode("");
    setName("");
    reload();
  }

  async function handleRemove(id: number) {
    await authFetch(`/api/master-data/skills/${id}`, { method: "PATCH" });
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Skills</h1>
        <p className="mt-1 text-sm text-ink-muted">Skill definitions and agent skill assignment.</p>
      </div>

      <Card>
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 p-4">
          <Input label="Code" type="text" required className="w-32" value={code} onChange={(e) => setCode(e.target.value)} />
          <Input label="Name" type="text" required className="w-64" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" loading={submitting}>
            Add skill
          </Button>
          {formError && <span className="text-sm text-critical">{formError}</span>}
        </form>
      </Card>

      {loading && <LoadingState label="Loading skills" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && skills?.length === 0 && (
        <EmptyState title="No skills configured yet" description="Nothing invented here - add real skills above once the business defines its skill taxonomy." />
      )}
      {!loading && !error && skills && skills.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {skills.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink-muted">{s.code}</td>
                  <td className="px-4 py-3 text-ink">{s.name}</td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" onClick={() => handleRemove(s.id)}>
                      Remove
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
