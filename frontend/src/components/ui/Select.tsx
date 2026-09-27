import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  /** Applied to the outer wrapper (label, or the control itself when there's no label) - for grid/flex placement, not for restyling the field. */
  className?: string;
}

/** Styled wrapper around a native <select> - keeps real <option> semantics and keyboard behavior, just restyles the chrome. */
export function Select({ label, className, title, ...props }: SelectProps) {
  const control = (
    <div className={cn("relative", !label && className)}>
      <select
        title={label ? undefined : title}
        className={cn(
          "h-9 w-full appearance-none rounded-lg border border-line-strong bg-surface px-3 pr-8 text-sm text-ink",
          "transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
          "hover:border-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
          "disabled:cursor-not-allowed disabled:border-line disabled:bg-canvas disabled:text-ink-faint disabled:hover:border-ink",
        )}
        {...props}
      />
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
    </div>
  );

  if (!label) return control;
  return (
    <label className="flex flex-col gap-1" title={title}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      {control}
    </label>
  );
}
