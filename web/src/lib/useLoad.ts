import { useCallback, useEffect, useRef, useState } from "react";

// Loads data on mount and again when `deps` change; `reload` runs the latest `load` on demand.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const latest = useRef(load);
  const reload = useCallback(() => {
    latest.current()
      .then((loaded) => {
        setData(loaded);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    latest.current = load;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);
  return { data, error, reload };
}
