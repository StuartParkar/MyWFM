import { cn } from "@/lib/cn";

export type BadgeTone = "success" | "warning" | "critical" | "info" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  critical: "bg-critical-soft text-critical",
  info: "bg-info-soft text-info",
  neutral: "bg-accent-soft text-ink-muted",
};

/**
 * The one place status color meaning is decided (build spec section 53):
 * success = healthy/protected, warning = warning, critical = critical,
 * info = informational. Every status pill in the app should render through
 * this component rather than picking colors ad hoc.
 */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", TONE_CLASSES[tone])}>
      {children}
    </span>
  );
}
