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
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm animate-content-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-white shadow-[var(--shadow-md)]">
            <Compass size={22} />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">Universal MyWFM</h1>
          <p className="mt-1 text-sm text-ink-muted">Workforce Management Control Platform</p>
        </div>

        <Card elevation="raised">
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
