"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { ROLE_LABELS } from "@mywfm/shared";

export function TopBar() {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
      <div />
      {user && (
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium text-ink">{user.displayName}</p>
            <p className="text-xs text-ink-muted">{user.roles.map((r) => ROLE_LABELS[r]).join(", ")}</p>
          </div>
          <Button
            variant="ghost"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
          >
            Sign out
          </Button>
        </div>
      )}
    </header>
  );
}
