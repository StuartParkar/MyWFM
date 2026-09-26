"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  createDefaultFilterState,
  resolveDateRangePreset,
  type CustomRange,
  type DateRangePreset,
  type GlobalFilterState,
} from "@mywfm/shared";
import { getPlaceholderBusinessToday } from "./businessToday";

const STORAGE_KEY = "mywfm.filters.v1";

interface FilterContextValue {
  filters: GlobalFilterState;
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

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<GlobalFilterState>(loadInitialState);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // Per-viewer convenience only - a storage failure (private browsing, quota) is not fatal.
    }
  }, [filters]);

  const setDateRangePreset = useCallback((preset: DateRangePreset, custom?: CustomRange) => {
    setFilters((f) => ({ ...f, dateRange: resolveDateRangePreset(preset, getPlaceholderBusinessToday(), custom) }));
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
    setFilters(createDefaultFilterState(getPlaceholderBusinessToday()));
  }, []);

  const value = useMemo<FilterContextValue>(
    () => ({ filters, setDateRangePreset, setProcess, setHod, setTl, setAgentSenior, setAgentId, setDesignation, reset }),
    [filters, setDateRangePreset, setProcess, setHod, setTl, setAgentSenior, setAgentId, setDesignation, reset],
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}
