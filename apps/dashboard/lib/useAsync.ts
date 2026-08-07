"use client";

import { useCallback, useEffect, useState } from "react";
import { staffErrorText } from "./staff-error-text";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: T };

/**
 * Shared loading/error/success fetch pattern (07_05 §16) for the staff
 * dashboard's read views — re-runs `load` whenever `deps` changes.
 * Stale-while-revalidate: the previous `success`/`error` result stays
 * visible while a subsequent fetch (dep change, `reload()`) is in
 * flight, rather than resetting to `loading` — this also avoids an
 * effect-body `setState` call that would otherwise happen synchronously
 * before any `await` (react-hooks/set-state-in-effect). `loading` is
 * therefore only ever the true initial state, set once via `useState`.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void } {
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
        if (!cancelled) setState({ status: "error", message: staffErrorText(error) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  return { ...state, reload };
}
