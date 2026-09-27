"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { FilterProvider } from "@/lib/filters/FilterContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="text-sm text-ink-muted">Loading…</p>
      </div>
    );
  }

  return (
    <FilterProvider>
      <div className="flex min-h-screen bg-canvas">
        <Sidebar />
        <div className="flex flex-1 flex-col">
          <TopBar />
          <GlobalFilterBar />
          <main className="flex-1 overflow-y-auto p-6">
            <div key={pathname} className="animate-content-in">
              {children}
            </div>
          </main>
        </div>
      </div>
    </FilterProvider>
  );
}
