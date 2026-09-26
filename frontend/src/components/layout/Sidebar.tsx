"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { CONTROL_TOWER, NAV_SECTIONS } from "@/lib/nav/navTree";

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-md px-3 py-1.5 text-sm transition-colors",
        active ? "bg-accent-soft font-medium text-accent" : "text-ink-muted hover:bg-canvas hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
      <div className="px-5 py-5">
        <span className="text-base font-semibold tracking-tight text-ink">MyWFM</span>
      </div>

      <nav className="flex-1 space-y-6 px-3 pb-6">
        <NavLink href={CONTROL_TOWER.path} label={CONTROL_TOWER.label} active={pathname === CONTROL_TOWER.path} />

        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">{section.label}</p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.path} href={item.path} label={item.label} active={pathname === item.path} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
