"use client";

import { RotateCcw } from "lucide-react";
import { useFilters, type LookupOption } from "@/lib/filters/FilterContext";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { DateRangePicker } from "./DateRangePicker";

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
      <DateRangePicker
        value={filters.dateRange}
        onSelectPreset={(preset) => setDateRangePreset(preset)}
        onApplyCustom={(startDate, endDate) => setDateRangePreset("CUSTOM", { startDate, endDate })}
      />

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
