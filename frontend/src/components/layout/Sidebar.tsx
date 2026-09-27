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

const SECTION_ICONS: Record<string, LucideIcon> = {
  Workforce: Users,
  Roster: CalendarDays,
  Intraday: Activity,
  Operations: Headset,
  Reports: ChartBar,
  Data: Database,
  Admin: Settings,
  System: Server,
};

function NavLink({ href, label, active, icon: Icon }: { href: string; label: string; active: boolean; icon?: LucideIcon }) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
        active ? "bg-accent-soft font-medium text-accent" : "text-ink-muted hover:bg-canvas hover:text-ink",
      )}
    >
      {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />}
      {Icon && <Icon size={16} className="shrink-0" />}
      {label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-white">
          <Compass size={17} />
        </span>
        <span className="text-base font-semibold tracking-tight text-ink">MyWFM</span>
      </div>

      <nav className="flex-1 space-y-6 px-3 pb-6">
        <NavLink href={CONTROL_TOWER.path} label={CONTROL_TOWER.label} active={pathname === CONTROL_TOWER.path} icon={LayoutDashboard} />

        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">{section.label}</p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.path} href={item.path} label={item.label} active={pathname === item.path} icon={SECTION_ICONS[section.label]} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
