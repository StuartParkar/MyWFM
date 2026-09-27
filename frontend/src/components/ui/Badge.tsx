import { cn } from "@/lib/cn";

export type BadgeTone = "success" | "warning" | "critical" | "info" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  critical: "bg-critical-soft text-critical",
  info: "bg-info-soft text-info",
  neutral: "bg-accent-soft text-ink-muted",
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
  children,
}: {
  tone?: BadgeTone;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  /** Small status dot instead of an icon - for dense spots like table cells. */
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", TONE_CLASSES[tone])}>
      {dot && <span className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASSES[tone])} />}
      {!dot && Icon && <Icon size={12} />}
      {children}
    </span>
  );
}
