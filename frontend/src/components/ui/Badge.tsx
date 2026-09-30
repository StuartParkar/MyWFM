import { cn } from "@/lib/cn";

export type BadgeTone = "success" | "warning" | "critical" | "info" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "border-success/20 bg-success-soft text-success",
  warning: "border-warning/20 bg-warning-soft text-warning",
  critical: "border-critical/20 bg-critical-soft text-critical",
  info: "border-info/20 bg-info-soft text-info",
  neutral: "border-line-strong/60 bg-accent-soft text-ink-muted",
};

const DOT_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  critical: "bg-critical",
  info: "bg-info",
  neutral: "bg-ink-faint",
};

/**
 * The one place status color meaning is decided (build spec section 53):
 * success = healthy/protected, warning = warning, critical = critical,
 * info = informational. Every status pill in the app should render through
 * this component rather than picking colors ad hoc.
 */
export function Badge({
  tone = "neutral",
  icon: Icon,
  dot = false,
  pulse = false,
  children,
}: {
  tone?: BadgeTone;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  /** Small status dot instead of an icon - for dense spots like table cells. */
  dot?: boolean;
  /** Gently pulses the dot - reserve for a genuinely live/ongoing state, not every badge. */
  pulse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex animate-[content-in_var(--duration-base)_var(--ease-spring)] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", TONE_CLASSES[tone])}>
      {dot && (
        <span className="relative flex size-1.5 shrink-0">
          {pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", DOT_CLASSES[tone])} />}
          <span className={cn("relative inline-flex size-full rounded-full", DOT_CLASSES[tone])} />
        </span>
      )}
      {!dot && Icon && <Icon size={12} />}
      {children}
    </span>
  );
}
