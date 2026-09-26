"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState, LoadingState } from "@/components/ui/States";

interface CodeNameRow {
  id: number;
  code: string;
  name: string;
}
interface NameRow {
  id: number;
  name: string;
}

function CodeNameSection({
  title,
  subtitle,
  items,
  endpoint,
  onChanged,
}: {
  title: string;
  subtitle: string;
  items: CodeNameRow[];
  endpoint: string;
  onChanged: () => void;
}) {
  const { authFetch } = useAuth();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await authFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name }) });
    setSubmitting(false);
    setCode("");
    setName("");
    onChanged();
  }

  async function handleRemove(id: number) {
    await authFetch(`${endpoint}/${id}`, { method: "PATCH" });
    onChanged();
  }

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <CardBody className="flex flex-col gap-3">
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            required
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          />
          <input
            required
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          />
          <Button type="submit" variant="secondary" disabled={submitting}>
            Add
          </Button>
        </form>
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-ink">
                {item.name} <span className="text-xs text-ink-faint">({item.code})</span>
              </span>
              <Button variant="ghost" onClick={() => handleRemove(item.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function DepartmentSection({ items, onChanged }: { items: NameRow[]; onChanged: () => void }) {
  const { authFetch } = useAuth();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await authFetch("/api/master-data/departments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    setSubmitting(false);
    setName("");
    onChanged();
  }

  async function handleRemove(id: number) {
    await authFetch(`/api/master-data/departments/${id}`, { method: "PATCH" });
    onChanged();
  }

  return (
    <Card>
      <CardHeader title="Departments" subtitle={`${items.length} total`} />
      <CardBody className="flex flex-col gap-3">
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            required
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          />
          <Button type="submit" variant="secondary" disabled={submitting}>
            Add
          </Button>
        </form>
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-ink">{item.name}</span>
              <Button variant="ghost" onClick={() => handleRemove(item.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export default function OrganizationPage() {
  const { authFetch } = useAuth();

  const fetcher = useCallback(async (): Promise<
    AsyncResult<{ locations: CodeNameRow[]; processes: CodeNameRow[]; departments: NameRow[] }>
  > => {
    try {
      const [locationsRes, processesRes, departmentsRes] = await Promise.all([
        authFetch("/api/master-data/locations"),
        authFetch("/api/master-data/processes"),
        authFetch("/api/master-data/departments"),
      ]);
      const [locationsBody, processesBody, departmentsBody] = (await Promise.all([
        locationsRes.json(),
        processesRes.json(),
        departmentsRes.json(),
      ])) as [ApiResponse<CodeNameRow[]>, ApiResponse<CodeNameRow[]>, ApiResponse<NameRow[]>];

      if (!locationsBody.success || !processesBody.success || !departmentsBody.success) {
        return { ok: false, message: "Could not load organization reference data." };
      }
      return { ok: true, data: { locations: locationsBody.data, processes: processesBody.data, departments: departmentsBody.data } };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch]);

  const { data, error, loading, reload } = useAsyncResource(fetcher);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Organization</h1>
        <p className="mt-1 text-sm text-ink-muted">Locations, processes and departments - derived from the real org hierarchy import.</p>
      </div>

      {loading && <LoadingState label="Loading organization data" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <CodeNameSection title="Locations" subtitle={`${data.locations.length} total`} items={data.locations} endpoint="/api/master-data/locations" onChanged={reload} />
          <CodeNameSection title="Processes" subtitle={`${data.processes.length} total`} items={data.processes} endpoint="/api/master-data/processes" onChanged={reload} />
          <DepartmentSection items={data.departments} onChanged={reload} />
        </div>
      )}
    </div>
  );
}
