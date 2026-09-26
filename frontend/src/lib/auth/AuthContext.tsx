"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ApiResponse, AuthenticatedUser, LoginResponse } from "@mywfm/shared";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export type LoginResult = { ok: true } | { ok: false; message: string };

interface AuthContextValue {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  login(email: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  /** Fetch wrapper for authenticated /api calls: attaches the bearer token and retries once via silent refresh on a 401. */
  authFetch(path: string, init?: RequestInit): Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

async function parseApiResponse<T>(res: Response): Promise<ApiResponse<T> | null> {
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const accessTokenRef = useRef<string | null>(null);

  const applySession = useCallback((data: LoginResponse) => {
    accessTokenRef.current = data.accessToken;
    setUser(data.user);
    setStatus("authenticated");
  }, []);

  const clearSession = useCallback(() => {
    accessTokenRef.current = null;
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  // Silently try to resume a session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
        const body = await parseApiResponse<LoginResponse>(res);
        if (cancelled) return;
        if (res.ok && body?.success) applySession(body.data);
        else clearSession();
      } catch {
        if (!cancelled) clearSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession, clearSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const body = await parseApiResponse<LoginResponse>(res);
      if (!res.ok || !body || !body.success) {
        return { ok: false, message: body && !body.success ? body.error.message : "Sign-in failed. Please try again." };
      }
      applySession(body.data);
      return { ok: true };
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
    clearSession();
  }, [clearSession]);

  const authFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const buildInit = (token: string | null): RequestInit => ({
        ...init,
        credentials: "include",
        headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });

      const first = await fetch(path, buildInit(accessTokenRef.current));
      if (first.status !== 401) return first;

      const refreshRes = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
      const refreshBody = await parseApiResponse<LoginResponse>(refreshRes);
      if (refreshRes.ok && refreshBody?.success) {
        applySession(refreshBody.data);
        return fetch(path, buildInit(refreshBody.data.accessToken));
      }

      clearSession();
      return first;
    },
    [applySession, clearSession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, authFetch }),
    [status, user, login, logout, authFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
