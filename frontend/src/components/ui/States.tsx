import { PackageOpen, TriangleAlert } from "lucide-react";
import { Button } from "./Button";

export function EmptyState({
  title,
  description,
  icon: Icon = PackageOpen,
}: {
  title: string;
  description: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
}) {
  return (
    <div className="animate-content-in flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon size={20} />
      </span>
      <h3 className="font-display mt-3 text-base text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-ink-muted">{description}</p>
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-4 animate-shimmer rounded" style={{ width: `${80 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-critical/30 bg-critical-soft px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-surface text-critical">
        <TriangleAlert size={20} />
      </span>
      <div>
        <h3 className="text-sm font-semibold text-critical">{title}</h3>
        <p className="mt-1 max-w-sm text-sm text-ink-muted">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
