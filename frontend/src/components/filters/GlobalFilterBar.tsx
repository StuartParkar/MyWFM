"use client";

import { DATE_RANGE_PRESETS, type DateRangePreset } from "@mywfm/shared";
import { useFilters } from "@/lib/filters/FilterContext";
import { Button } from "@/components/ui/Button";

const PRESET_LABELS: Record<Exclude<DateRangePreset, "CUSTOM">, string> = {
  YESTERDAY: "Yesterday",
  TODAY: "Today",
  LAST_7_DAYS: "Last 7 Days",
  LAST_14_DAYS: "Last 14 Days",
  LAST_30_DAYS: "Last 30 Days",
  THIS_WEEK: "This Week",
  LAST_WEEK: "Last Week",
  THIS_MONTH: "This Month",
  LAST_MONTH: "Last Month",
};

// "Custom Range" is a real value resolveDateRangePreset() supports, but no
// screen has a custom-range date-picker UI yet - offering it here with
// nothing behind it would be exactly the kind of half-finished feature build
// spec section 78 rules out. Add it back once a screen builds that picker.
const SELECTABLE_PRESETS = DATE_RANGE_PRESETS.filter((p): p is Exclude<DateRangePreset, "CUSTOM"> => p !== "CUSTOM");

function SelectField({
  label,
  value,
  disabled,
  title,
  children,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1" title={title}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      <select
        className="rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-faint"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

const MASTER_DATA_PENDING_TITLE = "Populated once Phase 2 master data (employees/organization) is imported.";

export function GlobalFilterBar() {
  const { filters, setDateRangePreset, setProcess, setHod, setTl, setAgentSenior, setDesignation, reset } = useFilters();

  return (
    <div className="flex flex-wrap items-end gap-4 border-b border-line bg-surface px-6 py-3">
      <SelectField label="Date Range" value={filters.dateRange.preset} onChange={(v) => setDateRangePreset(v as DateRangePreset)}>
        {SELECTABLE_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {PRESET_LABELS[preset]}
          </option>
        ))}
      </SelectField>
      <span className="pb-1.5 text-xs text-ink-faint">
        {filters.dateRange.startDate === filters.dateRange.endDate
          ? filters.dateRange.startDate
          : `${filters.dateRange.startDate} → ${filters.dateRange.endDate}`}
      </span>

      <SelectField label="HOD" value={filters.hod} disabled title={MASTER_DATA_PENDING_TITLE} onChange={setHod}>
        <option value="ALL">All</option>
      </SelectField>
      <SelectField label="TL" value={filters.tl} disabled title={MASTER_DATA_PENDING_TITLE} onChange={setTl}>
        <option value="ALL">All</option>
      </SelectField>
      <SelectField label="Agent / Senior" value={filters.agentSenior} disabled title={MASTER_DATA_PENDING_TITLE} onChange={setAgentSenior}>
        <option value="ALL">All</option>
      </SelectField>
      <SelectField label="Process" value={filters.process} disabled title={MASTER_DATA_PENDING_TITLE} onChange={setProcess}>
        <option value="ALL">All</option>
      </SelectField>
      <SelectField label="Designation" value={filters.designation} disabled title={MASTER_DATA_PENDING_TITLE} onChange={setDesignation}>
        <option value={filters.designation}>{filters.designation}</option>
      </SelectField>

      <Button variant="ghost" className="ml-auto" onClick={reset}>
        Reset filters
      </Button>
    </div>
  );
}
