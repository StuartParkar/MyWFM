import { cn } from "@/lib/cn";

type CardElevation = "flat" | "raised";

export function Card({
  className,
  children,
  elevation = "flat",
  interactive = false,
}: {
  className?: string;
  children: React.ReactNode;
  elevation?: CardElevation;
  /** Adds a hover lift + shadow, for cards that are themselves clickable. */
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-surface",
        elevation === "raised" ? "shadow-[var(--shadow-md)]" : "shadow-[var(--shadow-card)]",
        interactive &&
          "transition-[transform,box-shadow,border-color] duration-[var(--duration-base)] ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--shadow-md)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon size={16} />
          </span>
        )}
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
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
