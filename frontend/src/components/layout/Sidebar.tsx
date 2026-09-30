"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CalendarDays,
  ChartBar,
  Compass,
  Database,
  Headset,
  LayoutDashboard,
  Server,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { CONTROL_TOWER, NAV_SECTIONS } from "@/lib/nav/navTree";

const SECTION_META: Record<string, { icon: LucideIcon; colorVar: string }> = {
  Workforce: { icon: Users, colorVar: "--color-section-workforce" },
  Roster: { icon: CalendarDays, colorVar: "--color-section-roster" },
  Intraday: { icon: Activity, colorVar: "--color-section-intraday" },
  Operations: { icon: Headset, colorVar: "--color-section-operations" },
  Reports: { icon: ChartBar, colorVar: "--color-section-reports" },
  Data: { icon: Database, colorVar: "--color-section-data" },
  Admin: { icon: Settings, colorVar: "--color-section-admin" },
  System: { icon: Server, colorVar: "--color-section-system" },
};

function IconBadge({ icon: Icon, colorVar }: { icon: LucideIcon; colorVar: string }) {
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-lg transition-transform duration-[var(--duration-base)] ease-[var(--ease-spring)] group-hover:scale-110 group-hover:-rotate-3"
      style={{ backgroundColor: `var(${colorVar}-soft)`, color: `var(${colorVar})` }}
    >
      <Icon size={14} strokeWidth={2.25} />
    </span>
  );
}

function NavLink({ href, label, active, icon, colorVar, index }: { href: string; label: string; active: boolean; icon: LucideIcon; colorVar: string; index: number }) {
  return (
    <Link
      href={href}
      className={cn(
        "group animate-stagger-in relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
        active ? "bg-accent-soft font-semibold text-ink shadow-[var(--shadow-xs)]" : "text-ink-muted hover:bg-canvas hover:text-ink",
      )}
      style={{ "--stagger-delay": `${index * 22}ms` } as React.CSSProperties}
    >
      {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />}
      <IconBadge icon={icon} colorVar={colorVar} />
      {label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  let navIndex = 0;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="animate-glow-pulse flex size-9 items-center justify-center rounded-xl bg-accent text-white shadow-[var(--shadow-sm)]">
          <Compass size={18} />
        </span>
        <span className="font-display text-lg text-ink">MyWFM</span>
      </div>

      <nav className="flex-1 space-y-6 px-3 pb-6">
        <NavLink
          href={CONTROL_TOWER.path}
          label={CONTROL_TOWER.label}
          active={pathname === CONTROL_TOWER.path}
          icon={LayoutDashboard}
          colorVar="--color-accent"
          index={navIndex++}
        />

        {NAV_SECTIONS.map((section) => {
          const meta = SECTION_META[section.label]!;
          return (
            <div key={section.label}>
              <p className="px-2.5 pb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">{section.label}</p>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink key={item.path} href={item.path} label={item.label} active={pathname === item.path} icon={meta.icon} colorVar={meta.colorVar} index={navIndex++} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
