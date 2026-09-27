"use client";

import { RotateCcw } from "lucide-react";
import { DATE_RANGE_PRESETS, type DateRangePreset } from "@mywfm/shared";
import { useFilters, type LookupOption } from "@/lib/filters/FilterContext";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";

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
  options,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  title?: string;
  options: LookupOption[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      label={label}
      title={title}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="ALL">All</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

export function GlobalFilterBar() {
  const {
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
    setDesignation,
    reset,
  } = useFilters();

  return (
    <div className="flex flex-wrap items-end gap-4 border-b border-line bg-surface px-6 py-3">
      <Select
        label="Date Range"
        value={filters.dateRange.preset}
        onChange={(e) => setDateRangePreset(e.target.value as DateRangePreset)}
      >
        {SELECTABLE_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {PRESET_LABELS[preset]}
          </option>
        ))}
      </Select>
      <span className="pb-2 text-xs text-ink-faint tabular-nums">
        {filters.dateRange.startDate === filters.dateRange.endDate
          ? filters.dateRange.startDate
          : `${filters.dateRange.startDate} → ${filters.dateRange.endDate}`}
      </span>

      <SelectField label="HOD" value={filters.hod} options={hodOptions} onChange={setHod} />
      <SelectField
        label="TL"
        value={filters.tl}
        options={tlOptions}
        disabled={filters.hod === "ALL"}
        title={filters.hod === "ALL" ? "Select a HOD first" : undefined}
        onChange={setTl}
      />
      <SelectField
        label="Agent / Senior"
        value={filters.agentSenior}
        options={agentSeniorOptions}
        disabled={filters.tl === "ALL"}
        title={filters.tl === "ALL" ? "Select a TL first" : undefined}
        onChange={setAgentSenior}
      />
      <SelectField label="Process" value={filters.process} options={processOptions} onChange={setProcess} />
      <SelectField label="Designation" value={filters.designation} options={designationOptions} onChange={setDesignation} />

      <Button variant="ghost" size="sm" icon={RotateCcw} className="ml-auto" onClick={reset}>
        Reset filters
      </Button>
    </div>
  );
}
