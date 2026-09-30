import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-strong))] text-white shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow-accent)] active:translate-y-0",
  secondary: "border border-line-strong bg-surface text-ink hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[var(--shadow-sm)] active:translate-y-0",
  ghost: "text-ink-muted hover:bg-accent-soft hover:text-accent",
  danger: "bg-critical text-white shadow-[var(--shadow-xs)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] hover:opacity-95 active:translate-y-0",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-xs",
  md: "h-9 gap-2 rounded-lg px-4 text-sm",
  lg: "h-11 gap-2 rounded-lg px-5 text-sm",
};

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  trailingIcon?: React.ComponentType<{ size?: number | string; className?: string }>;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  trailingIcon: TrailingIcon,
  loading = false,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const iconSize = ICON_SIZE[size];
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold",
        "transition-[transform,background-color,border-color,box-shadow,opacity] duration-[var(--duration-base)] ease-[var(--ease-spring)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        "active:scale-[0.97]",
        (disabled || loading) && "cursor-not-allowed opacity-50 hover:translate-y-0 hover:shadow-none active:scale-100",
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : (
        Icon && <Icon size={iconSize} />
      )}
      {children}
      {!loading && TrailingIcon && <TrailingIcon size={iconSize} />}
    </button>
  );
}
