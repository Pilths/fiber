import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";

export type StoredRoute = components["schemas"]["SegmentRouteOut"];
export type RouteState = "active" | "removing" | "removed";

const UNDO_MS = 5000;

// The visible routes of one segment and the Remove / Undo steps. Remove hides the route group (never deletes it);
// the row stays 5 seconds as "removed" with Undo, then goes. `onChanged` reloads the count column.
export function useSegmentRoutes(segmentId: number, onChanged: () => void) {
  const [routes, setRoutes] = useState<StoredRoute[]>([]);
  const [states, setStates] = useState<Record<number, RouteState>>({});
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<Record<number, number>>({});

  const load = useCallback(() => {
    api.get("/api/admin/kmz/segments/{segment_id}/routes", { path: { segment_id: segmentId } })
      .then((loaded) => {
        setRoutes(loaded);
        setStates({});
        setError(null);
      })
      .catch((caught) => setError(errorText(caught, "Could not load the routes.")));
  }, [segmentId]);
  useEffect(load, [load]);
  useEffect(() => () => Object.values(timers.current).forEach(window.clearTimeout), []);

  const setState = (id: number, state: RouteState | null) => {
    setStates((old) => {
      const next = { ...old };
      if (state == null) {
        delete next[id];
      } else {
        next[id] = state;
      }
      return next;
    });
  };

  const hide = async (id: number, hidden: boolean) => {
    const path = { group_id: id };
    await api.patch("/api/admin/kmz/groups/{group_id}", { path, body: { hidden, remarks: "" } });
    onChanged();
  };

  const dropRow = (id: number) => {
    setRoutes((old) => old.filter((route) => route.id !== id));
    setState(id, null);
  };

  const ask = (id: number) => setState(id, "removing");
  const cancel = (id: number) => setState(id, null);

  const remove = async (id: number) => {
    try {
      await hide(id, true);
      setState(id, "removed");
      timers.current[id] = window.setTimeout(() => dropRow(id), UNDO_MS);
    } catch (caught) {
      setError(errorText(caught, "Could not remove the route."));
    }
  };

  const undo = async (id: number) => {
    window.clearTimeout(timers.current[id]);
    try {
      await hide(id, false);
      setState(id, null);
    } catch (caught) {
      setError(errorText(caught, "Could not undo."));
    }
  };

  return { routes, states, error, load, ask, cancel, remove, undo };
}
