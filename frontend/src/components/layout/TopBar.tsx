"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { ROLE_LABELS } from "@mywfm/shared";
import { findNavLeaf } from "@/lib/nav/navTree";
import { cn } from "@/lib/cn";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function TopBar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const pageTitle = findNavLeaf(pathname)?.label ?? "Universal MyWFM";

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
      <h1 className="font-display text-xl text-ink">{pageTitle}</h1>
      {user && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="group flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-canvas"
          >
            <span
              className="flex size-8 items-center justify-center rounded-full text-xs font-semibold text-white shadow-[var(--shadow-xs)] transition-transform duration-[var(--duration-base)] ease-[var(--ease-spring)] group-hover:scale-110"
              style={{ backgroundImage: "linear-gradient(135deg, var(--color-accent), var(--color-accent-strong))" }}
            >
              {initials(user.displayName)}
            </span>
            <ChevronDown size={14} className={cn("text-ink-faint transition-transform duration-[var(--duration-fast)]", menuOpen && "rotate-180")} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-10 mt-2 w-56 animate-content-in rounded-lg border border-line bg-surface p-1.5 shadow-[var(--shadow-lg)]">
              <div className="px-2.5 py-2">
                <p className="text-sm font-medium text-ink">{user.displayName}</p>
                <p className="text-xs text-ink-muted">{user.roles.map((r) => ROLE_LABELS[r]).join(", ")}</p>
              </div>
              <div className="my-1 h-px bg-line" />
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  router.replace("/login");
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-ink-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-critical-soft hover:text-critical"
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
