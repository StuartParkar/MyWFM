"use client";

import { useCallback, useEffect, useState } from "react";

export type AsyncResult<T> = { ok: true; data: T } | { ok: false; message: string };

interface AsyncResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * The one place "fetch on mount, allow retry" lives, so every page that reads
 * from the backend does it the same way: an inline, cancellation-guarded
 * effect (matching AuthContext's pattern) rather than an effect that just
 * calls an external useCallback - the latter trips
 * react-hooks/set-state-in-effect because the linter can't see that the
 * setState calls only happen after the awaited fetch resolves.
 */
export function useAsyncResource<T>(fetcher: () => Promise<AsyncResult<T>>): AsyncResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      const result = await fetcher();
      if (cancelled) return;
      if (result.ok) setData(result.data);
      else setError(result.message);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // fetcher is intentionally excluded: callers pass a fresh closure on every
    // render, and depending on it would refetch on every render. reloadToken
    // is the only thing meant to re-trigger this effect after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { data, error, loading, reload };
}
