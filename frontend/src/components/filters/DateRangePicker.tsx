"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { DATE_RANGE_PRESETS, type DateRange, type DateRangePreset } from "@mywfm/shared";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

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

const QUICK_PRESETS = DATE_RANGE_PRESETS.filter((p): p is Exclude<DateRangePreset, "CUSTOM"> => p !== "CUSTOM");

function formatDisplay(range: DateRange): string {
  if (range.preset !== "CUSTOM") return PRESET_LABELS[range.preset];
  return range.startDate === range.endDate ? range.startDate : `${range.startDate} → ${range.endDate}`;
}

export function DateRangePicker({
  value,
  onSelectPreset,
  onApplyCustom,
}: {
  value: DateRange;
  onSelectPreset: (preset: Exclude<DateRangePreset, "CUSTOM">) => void;
  onApplyCustom: (startDate: string, endDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"single" | "range">(value.startDate === value.endDate ? "single" : "range");
  const [draftStart, setDraftStart] = useState(value.startDate);
  const [draftEnd, setDraftEnd] = useState(value.endDate);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggleOpen() {
    if (!open) {
      setMode(value.startDate === value.endDate ? "single" : "range");
      setDraftStart(value.startDate);
      setDraftEnd(value.endDate);
    }
    setOpen((v) => !v);
  }

  function applyCustom() {
    if (!draftStart) return;
    onApplyCustom(draftStart, mode === "single" ? draftStart : draftEnd || draftStart);
    setOpen(false);
  }

  return (
    <div className="relative" ref={popoverRef}>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Date Range</span>
        <button
          type="button"
          onClick={toggleOpen}
          className={cn(
            "flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-ink",
            "transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
            "hover:border-accent/40 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
          )}
        >
          <Calendar size={14} className="text-accent" />
          <span className="tabular-nums">{formatDisplay(value)}</span>
          <ChevronDown size={14} className={cn("text-ink-faint transition-transform duration-[var(--duration-fast)]", open && "rotate-180")} />
        </button>
      </label>

      {open && (
        <div className="animate-content-in absolute left-0 top-full z-20 mt-2 flex w-[21rem] overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-lg)]">
          <div className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-line bg-surface-sunken p-2">
            {QUICK_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  onSelectPreset(preset);
                  setOpen(false);
                }}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors duration-[var(--duration-fast)]",
                  value.preset === preset ? "bg-accent text-white" : "text-ink-muted hover:bg-surface hover:text-ink",
                )}
              >
                {PRESET_LABELS[preset]}
              </button>
            ))}
          </div>

          <div className="flex flex-1 flex-col gap-3 p-3">
            <div className="flex rounded-lg border border-line-strong p-0.5">
              <button
                type="button"
                onClick={() => setMode("single")}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors duration-[var(--duration-fast)]",
                  mode === "single" ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink",
                )}
              >
                Single Date
              </button>
              <button
                type="button"
                onClick={() => setMode("range")}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors duration-[var(--duration-fast)]",
                  mode === "range" ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink",
                )}
              >
                Date Range
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{mode === "single" ? "Date" : "From"}</span>
              <input
                type="date"
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
                className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              />
            </label>
            {mode === "range" && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">To</span>
                <input
                  type="date"
                  value={draftEnd}
                  min={draftStart || undefined}
                  onChange={(e) => setDraftEnd(e.target.value)}
                  className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                />
              </label>
            )}

            <Button size="sm" onClick={applyCustom} disabled={!draftStart || (mode === "range" && !draftEnd)}>
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
