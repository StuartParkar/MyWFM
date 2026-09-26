"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ApiResponse } from "@mywfm/shared";
import {
  createDefaultFilterState,
  resolveDateRangePreset,
  type CustomRange,
  type DateRangePreset,
  type GlobalFilterState,
} from "@mywfm/shared";
import { useAuth } from "@/lib/auth/AuthContext";
import { getPlaceholderBusinessToday } from "./businessToday";

const STORAGE_KEY = "mywfm.filters.v1";

export interface LookupOption {
  id: string;
  label: string;
}

interface FilterContextValue {
  filters: GlobalFilterState;
  hodOptions: LookupOption[];
  tlOptions: LookupOption[];
  agentSeniorOptions: LookupOption[];
  processOptions: LookupOption[];
  designationOptions: LookupOption[];
  setDateRangePreset(preset: DateRangePreset, custom?: CustomRange): void;
  setProcess(value: string): void;
  setHod(value: string): void;
  setTl(value: string): void;
  setAgentSenior(value: string): void;
  setAgentId(value: string): void;
  setDesignation(value: string): void;
  reset(): void;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters must be used within <FilterProvider>");
  return ctx;
}

function loadInitialState(): GlobalFilterState {
  const fallback = createDefaultFilterState(getPlaceholderBusinessToday());
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<GlobalFilterState>) };
  } catch {
    return fallback;
  }
}

interface OrgLookupRow {
  employeeId: string;
  fullName: string;
  aliasName: string | null;
}

function toOption(row: OrgLookupRow): LookupOption {
  return { id: row.employeeId, label: row.aliasName ? `${row.fullName} (${row.aliasName})` : row.fullName };
}

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const { authFetch } = useAuth();
  const [filters, setFilters] = useState<GlobalFilterState>(loadInitialState);

  // Starts as the placeholder, replaced once the real (config-driven, Business Day Engine)
  // answer loads below. A ref rather than state: setDateRangePreset/reset read the *current*
  // value at call time without needing to be recreated (and re-run their own effects) every
  // time it updates.
  const businessTodayRef = useRef<string>(getPlaceholderBusinessToday());

  const [hodOptions, setHodOptions] = useState<LookupOption[]>([]);
  const [tlOptions, setTlOptions] = useState<LookupOption[]>([]);
  const [agentSeniorOptions, setAgentSeniorOptions] = useState<LookupOption[]>([]);
  const [processOptions, setProcessOptions] = useState<LookupOption[]>([]);
  const [designationOptions, setDesignationOptions] = useState<LookupOption[]>([]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // Per-viewer convenience only - a storage failure (private browsing, quota) is not fatal.
    }
  }, [filters]);

  // Load once: the real, config-driven business date (build spec section 9), replacing the
  // placeholder businessTodayRef started with. A fetch failure here just leaves the
  // placeholder in place rather than breaking filtering.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/business-day/today");
        const body = (await res.json()) as ApiResponse<{ businessDate: string }>;
        if (!cancelled && res.ok && body.success) businessTodayRef.current = body.data.businessDate;
      } catch {
        // Keep the placeholder.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  // Load once: the top-level lookups that don't depend on any selection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [hodsRes, processesRes, designationsRes] = await Promise.all([
        authFetch("/api/master-data/lookups/hods"),
        authFetch("/api/master-data/processes"),
        authFetch("/api/master-data/designations"),
      ]);
      if (cancelled) return;
      const hodsBody = (await hodsRes.json()) as ApiResponse<OrgLookupRow[]>;
      if (hodsBody.success) setHodOptions(hodsBody.data.map(toOption));

      const processesBody = (await processesRes.json()) as ApiResponse<{ id: number; code: string; name: string }[]>;
      if (processesBody.success) setProcessOptions(processesBody.data.map((p) => ({ id: String(p.id), label: p.name })));

      const designationsBody = (await designationsRes.json()) as ApiResponse<{ code: string; name: string }[]>;
      if (designationsBody.success) setDesignationOptions(designationsBody.data.map((d) => ({ id: d.code, label: d.name })));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // TLs depend on the selected HOD.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (filters.hod === "ALL") {
        setTlOptions([]);
        return;
      }
      const res = await authFetch(`/api/master-data/lookups/tls?hodId=${encodeURIComponent(filters.hod)}`);
      if (cancelled) return;
      const body = (await res.json()) as ApiResponse<OrgLookupRow[]>;
      if (body.success) setTlOptions(body.data.map(toOption));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.hod]);

  // Agent/Senior depends on the selected TL.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (filters.tl === "ALL") {
        setAgentSeniorOptions([]);
        return;
      }
      const res = await authFetch(`/api/master-data/lookups/agents?tlId=${encodeURIComponent(filters.tl)}`);
      if (cancelled) return;
      const body = (await res.json()) as ApiResponse<OrgLookupRow[]>;
      if (body.success) setAgentSeniorOptions(body.data.map(toOption));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.tl]);

  const setDateRangePreset = useCallback((preset: DateRangePreset, custom?: CustomRange) => {
    setFilters((f) => ({ ...f, dateRange: resolveDateRangePreset(preset, businessTodayRef.current, custom) }));
  }, []);

  // Cascade: HOD -> TL -> Agent/Senior -> Individual Agent (build spec section 8).
  // Changing an upstream level resets everything downstream of it, since the
  // previously selected value may no longer belong under the new selection.
  const setHod = useCallback((value: string) => {
    setFilters((f) => ({ ...f, hod: value, tl: "ALL", agentSenior: "ALL", agentId: "ALL" }));
  }, []);

  const setTl = useCallback((value: string) => {
    setFilters((f) => ({ ...f, tl: value, agentSenior: "ALL", agentId: "ALL" }));
  }, []);

  const setAgentSenior = useCallback((value: string) => {
    setFilters((f) => ({ ...f, agentSenior: value, agentId: "ALL" }));
  }, []);

  const setAgentId = useCallback((value: string) => {
    setFilters((f) => ({ ...f, agentId: value }));
  }, []);

  // Process and Designation are independent of the HOD/TL/Agent cascade.
  const setProcess = useCallback((value: string) => {
    setFilters((f) => ({ ...f, process: value }));
  }, []);

  const setDesignation = useCallback((value: string) => {
    setFilters((f) => ({ ...f, designation: value }));
  }, []);

  const reset = useCallback(() => {
    setFilters(createDefaultFilterState(businessTodayRef.current));
  }, []);

  const value = useMemo<FilterContextValue>(
    () => ({
      filters,
      hodOptions,
      tlOptions,
      agentSeniorOptions,
      processOptions,
      designationOptions,
      setDateRangePreset,
      setProcess,
      setHod,
      setTl,
      setAgentSenior,
      setAgentId,
      setDesignation,
      reset,
    }),
    [
      filters,
      hodOptions,
      tlOptions,
      agentSeniorOptions,
      processOptions,
      designationOptions,
      setDateRangePreset,
      setProcess,
      setHod,
      setTl,
      setAgentSenior,
      setAgentId,
      setDesignation,
      reset,
    ],
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}
