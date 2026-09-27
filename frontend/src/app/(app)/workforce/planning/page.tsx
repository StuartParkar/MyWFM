"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAsyncResource, type AsyncResult } from "@/lib/hooks/useAsyncResource";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";

interface PlanRow {
  workforcePlanId: number;
  businessMonth: string;
  departmentName: string | null;
  processName: string | null;
  locationName: string | null;
  designationName: string | null;
  requiredHC: number;
  plannedHiresHC: number;
  plannedExitsHC: number;
  currentHC: number;
  futureHC: number;
  hiringGap: number;
  notes: string | null;
  version: number;
  createdByName: string;
  createdAt: string;
}

interface IdNameRow {
  id: number;
  code: string;
  name: string;
}

function gapTone(gap: number): BadgeTone {
  return gap > 0 ? "critical" : gap < 0 ? "warning" : "success";
}

function currentMonthValue(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

const EMPTY_FORM = { businessMonth: currentMonthValue(), departmentId: "", processId: "", locationId: "", designationId: "", requiredHC: "", plannedHiresHC: "0", plannedExitsHC: "0", notes: "" };

async function fetchLookup(authFetch: (path: string) => Promise<Response>, path: string): Promise<AsyncResult<IdNameRow[]>> {
  try {
    const res = await authFetch(path);
    const body = (await res.json()) as ApiResponse<IdNameRow[]>;
    if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, message: "Could not reach the backend." };
  }
}

export default function WorkforcePlanningPage() {
  const { authFetch } = useAuth();
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");

  const departmentsFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/departments"), [authFetch]);
  const processesFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/processes"), [authFetch]);
  const locationsFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/locations"), [authFetch]);
  const designationsFetcher = useCallback(() => fetchLookup(authFetch, "/api/master-data/designations"), [authFetch]);
  const { data: departments } = useAsyncResource(departmentsFetcher);
  const { data: processes } = useAsyncResource(processesFetcher);
  const { data: locations } = useAsyncResource(locationsFetcher);
  const { data: designations } = useAsyncResource(designationsFetcher);

  const fetcher = useCallback(async (): Promise<AsyncResult<PlanRow[]>> => {
    try {
      const params = new URLSearchParams();
      if (departmentFilter) params.set("departmentId", departmentFilter);
      if (processFilter) params.set("processId", processFilter);
      if (locationFilter) params.set("locationId", locationFilter);
      if (designationFilter) params.set("designationId", designationFilter);
      const res = await authFetch(`/api/workforce/plans?${params}`);
      const body = (await res.json()) as ApiResponse<PlanRow[]>;
      if (!res.ok || !body.success) return { ok: false, message: !body.success ? body.error.message : `Request failed (${res.status})` };
      return { ok: true, data: body.data };
    } catch {
      return { ok: false, message: "Could not reach the backend." };
    }
  }, [authFetch, departmentFilter, processFilter, locationFilter, designationFilter]);
  const { data: plans, error, loading, reload } = useAsyncResource(fetcher, [departmentFilter, processFilter, locationFilter, designationFilter]);

  const [form, setForm] = useState(EMPTY_FORM);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submitPlan(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.businessMonth || !form.requiredHC) {
      setFormError("Business month and Required HC are required.");
      return;
    }
    if (!form.departmentId && !form.processId && !form.locationId && !form.designationId) {
      setFormError("Select at least one of department, process, location or designation.");
      return;
    }
    setFormBusy(true);
    const res = await authFetch("/api/workforce/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessMonth: `${form.businessMonth}-01`,
        departmentId: form.departmentId || null,
        processId: form.processId || null,
        locationId: form.locationId || null,
        designationId: form.designationId || null,
        requiredHC: Number(form.requiredHC),
        plannedHiresHC: Number(form.plannedHiresHC) || 0,
        plannedExitsHC: Number(form.plannedExitsHC) || 0,
        notes: form.notes || null,
      }),
    });
    setFormBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as ApiResponse<unknown>;
      setFormError(!body.success ? body.error.message : "Could not save the plan.");
      return;
    }
    setForm(EMPTY_FORM);
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Workforce Planning</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Current/Required/Future HC and Hiring Gap by month, and any combination of department/
          process/location/designation (build spec section 20). Current HC is real, live
          headcount (Process via each employee&rsquo;s primary `master.EmployeeProcess` link);
          Required HC and planned hires/exits are entered targets, versioned - editing a plan
          never overwrites its prior version. Future HC = Current HC + this plan&rsquo;s own
          stated planned hires − planned exits (stated cumulatively from today through the
          plan&rsquo;s month, not month-over-month) - see documentation/workforce.md.
        </p>
      </div>

      <Card>
        <CardHeader title="Submit a plan" />
        <CardBody>
          <form onSubmit={submitPlan} className="flex flex-wrap items-end gap-3">
            <Input label="Month" type="month" value={form.businessMonth} onChange={(e) => setForm((f) => ({ ...f, businessMonth: e.target.value }))} />
            <Select label="Department" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
              <option value="">Not broken down</option>
              {departments?.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
            <Select label="Process" value={form.processId} onChange={(e) => setForm((f) => ({ ...f, processId: e.target.value }))}>
              <option value="">Not broken down</option>
              {processes?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            <Select label="Location" value={form.locationId} onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}>
              <option value="">Not broken down</option>
              {locations?.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
            <Select label="Designation" value={form.designationId} onChange={(e) => setForm((f) => ({ ...f, designationId: e.target.value }))}>
              <option value="">Not broken down</option>
              {designations?.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
            <Input label="Required HC" type="number" min="0" className="w-24" value={form.requiredHC} onChange={(e) => setForm((f) => ({ ...f, requiredHC: e.target.value }))} />
            <Input label="Planned hires" type="number" min="0" className="w-24" value={form.plannedHiresHC} onChange={(e) => setForm((f) => ({ ...f, plannedHiresHC: e.target.value }))} />
            <Input label="Planned exits" type="number" min="0" className="w-24" value={form.plannedExitsHC} onChange={(e) => setForm((f) => ({ ...f, plannedExitsHC: e.target.value }))} />
            <Input label="Notes" type="text" className="min-w-[10rem]" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <Button type="submit" loading={formBusy}>
              {formBusy ? "Saving..." : "Save plan"}
            </Button>
          </form>
          {formError && <p className="mt-2 text-sm text-critical">{formError}</p>}
        </CardBody>
      </Card>

      <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
        <Select label="Department" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
          <option value="">All</option>
          {departments?.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </Select>
        <Select label="Process" value={processFilter} onChange={(e) => setProcessFilter(e.target.value)}>
          <option value="">All</option>
          {processes?.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <Select label="Location" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
          <option value="">All</option>
          {locations?.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </Select>
        <Select label="Designation" value={designationFilter} onChange={(e) => setDesignationFilter(e.target.value)}>
          <option value="">All</option>
          {designations?.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </Select>
      </Card>

      {loading && <LoadingState label="Loading plans" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && plans?.length === 0 && <EmptyState title="No plans yet" description="Use the form above to set a monthly HC target." />}
      {!loading && !error && plans && plans.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3 font-medium">Month</th>
                <th className="px-4 py-3 font-medium">Dimensions</th>
                <th className="px-4 py-3 font-medium">Current</th>
                <th className="px-4 py-3 font-medium">Required</th>
                <th className="px-4 py-3 font-medium">Planned +/-</th>
                <th className="px-4 py-3 font-medium">Future</th>
                <th className="px-4 py-3 font-medium">Hiring Gap</th>
                <th className="px-4 py-3 font-medium">Version</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.workforcePlanId} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink font-medium tabular-nums">{p.businessMonth.slice(0, 7)}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {[p.departmentName, p.processName, p.locationName, p.designationName].filter(Boolean).join(" / ") || "Company-wide"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{p.currentHC}</td>
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{p.requiredHC}</td>
                  <td className="px-4 py-3 text-ink-faint tabular-nums">+{p.plannedHiresHC} / -{p.plannedExitsHC}</td>
                  <td className="px-4 py-3 text-ink tabular-nums">{p.futureHC}</td>
                  <td className="px-4 py-3">
                    <Badge tone={gapTone(p.hiringGap)}>{p.hiringGap > 0 ? `+${p.hiringGap} to hire` : p.hiringGap < 0 ? `${p.hiringGap} over plan` : "On target"}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-faint tabular-nums">v{p.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
