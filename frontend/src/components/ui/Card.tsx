import { cn } from "@/lib/cn";

type CardElevation = "flat" | "raised";

export function Card({
  className,
  children,
  elevation = "flat",
  interactive = false,
  accentVar,
}: {
  className?: string;
  children: React.ReactNode;
  elevation?: CardElevation;
  /** Adds a hover lift + glow, for cards that are themselves clickable. */
  interactive?: boolean;
  /** A CSS color var (e.g. "--color-section-roster") painted as a thin top edge - a hotel-key-
   * card accent stripe, for a card that belongs to a specific, colorful context. */
  accentVar?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-line bg-surface",
        elevation === "raised" ? "shadow-[var(--shadow-md)]" : "shadow-[var(--shadow-card)]",
        interactive &&
          "transition-[transform,box-shadow,border-color] duration-[var(--duration-base)] ease-[var(--ease-standard)] hover:-translate-y-1 hover:border-accent/30 hover:shadow-[var(--shadow-lg)]",
        className,
      )}
    >
      {accentVar && <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: `var(${accentVar})` }} />}
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon: Icon,
  colorVar = "--color-accent",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  /** A CSS color var for the icon badge - defaults to the brand accent, pass a
   * --color-section-* var to match a specific domain. */
  colorVar?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="flex items-start gap-3">
        {Icon && (
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `var(${colorVar}-soft)`, color: `var(${colorVar})` }}
          >
            <Icon size={16} />
          </span>
        )}
        <div>
          <h2 className="font-display text-base text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}
