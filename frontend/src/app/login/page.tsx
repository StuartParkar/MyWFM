"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Compass, Lock, Mail, TriangleAlert } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export default function LoginPage() {
  const { status, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/control-tower");
  }, [status, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await login(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.replace("/control-tower");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4">
      {/* Decorative gradient mesh - three large, softly-blurred color fields drifting slowly.
          Pure background texture: aria-hidden, no information lives here. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="animate-mesh-drift absolute -left-32 -top-32 size-[36rem] rounded-full opacity-[0.16] blur-3xl"
          style={{ background: "radial-gradient(circle, var(--color-accent), transparent 70%)" }}
        />
        <div
          className="animate-mesh-drift absolute -bottom-40 -right-20 size-[32rem] rounded-full opacity-[0.14] blur-3xl"
          style={{ background: "radial-gradient(circle, var(--color-section-roster), transparent 70%)", animationDelay: "-7s" }}
        />
        <div
          className="animate-mesh-drift absolute bottom-1/3 left-1/4 size-[24rem] rounded-full opacity-[0.10] blur-3xl"
          style={{ background: "radial-gradient(circle, var(--color-section-intraday), transparent 70%)", animationDelay: "-14s" }}
        />
        {/* A faint compass-rose watermark - the brand mark's own motif, echoed large. */}
        <svg viewBox="0 0 200 200" className="absolute right-[8%] top-[12%] size-64 text-accent opacity-[0.06]">
          <circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="100" cy="100" r="70" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M100 8 L108 92 L100 100 L92 92 Z" fill="currentColor" />
          <path d="M100 192 L92 108 L100 100 L108 108 Z" fill="currentColor" />
          <path d="M8 100 L92 92 L100 100 L92 108 Z" fill="currentColor" opacity="0.6" />
          <path d="M192 100 L108 108 L100 100 L108 92 Z" fill="currentColor" opacity="0.6" />
        </svg>
      </div>

      <div className="relative w-full max-w-sm animate-content-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="animate-glow-pulse flex size-12 items-center justify-center rounded-2xl bg-accent text-white shadow-[var(--shadow-glow-accent)]">
            <Compass size={24} />
          </span>
          <h1 className="font-display mt-4 text-2xl text-ink">Universal MyWFM</h1>
          <p className="mt-1 text-sm text-ink-muted">Workforce Management Control Platform</p>
        </div>

        <Card elevation="raised" className="backdrop-blur-sm">
          <CardBody className="flex flex-col gap-4">
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <Input
                label="Email"
                type="email"
                icon={Mail}
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                label="Password"
                type="password"
                icon={Lock}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              {error && (
                <p className="flex items-start gap-1.5 text-sm text-critical">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              )}

              <Button type="submit" loading={submitting} className="mt-1 w-full">
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
