"use client";

import { useCallback, useEffect, useState } from "react";
import { platformErrorText } from "./platform-error-text";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: T };

/** Same shared fetch pattern as `lib/useAsync.ts`, kept as its own copy (not imported) so the platform-admin surface never couples to the staff-identity error-text module (same domain-isolation discipline as the rest of this codebase). */
export function useAsyncPlatform<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ status: "success", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: platformErrorText(error) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  return { ...state, reload };
}
