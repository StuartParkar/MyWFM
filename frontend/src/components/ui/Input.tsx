import { cn } from "@/lib/cn";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  /** Applied to the outer wrapper (label, or the control itself when there's no label) - for grid/flex placement, not for restyling the field. */
  className?: string;
}

/** Styled wrapper around a native <input> - adds an optional label and leading icon. */
export function Input({ label, icon: Icon, className, ...props }: InputProps) {
  const control = (
    <div className={cn("group relative", !label && className)}>
      {Icon && (
        <Icon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint transition-colors duration-[var(--duration-fast)] group-focus-within:text-accent" />
      )}
      <input
        className={cn(
          "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-ink placeholder:font-normal placeholder:text-ink-faint",
          Icon && "pl-9",
          "transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
          "hover:border-accent/40 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
          "disabled:cursor-not-allowed disabled:border-line disabled:bg-canvas disabled:text-ink-faint",
        )}
        {...props}
      />
    </div>
  );

  if (!label) return control;
  return (
    <label className={cn("group/field flex flex-col gap-1.5", className)}>
      <span className="text-xs font-semibold text-ink-muted transition-colors duration-[var(--duration-fast)] group-focus-within/field:text-accent">{label}</span>
      {control}
    </label>
  );
}
