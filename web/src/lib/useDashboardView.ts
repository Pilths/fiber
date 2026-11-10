import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import type { View } from "@/components/Header";

type Bell = components["schemas"]["Bell"];

// Users has its own URL (#users) so it can be visited directly; other views keep the #segment= hash.
function writeViewHash(view: View) {
  if (view === "users") {
    history.replaceState(null, "", "#users");
    return;
  }
  const leavingUsers = location.hash === "#users";
  const leavingRoute = view !== "map" && location.hash.startsWith("#route=");
  if (leavingUsers || leavingRoute) {
    history.replaceState(null, "", location.pathname);
  }
}

// The tab shown, the header counts (approvals waiting, my stale reservations), and whether Upload was opened.
export function useDashboardView() {
  const [view, setViewState] = useState<View>(location.hash === "#users" ? "users" : "map");
  const [bell, setBell] = useState<Bell | null>(null);
  const [stale, setStale] = useState(0);
  // Upload stays mounted once opened (hidden on other views),
  // so a staged preview and its choices survive tab changes.
  const [uploadSeen, setUploadSeen] = useState(false);
  if (view === "upload" && !uploadSeen) {
    setUploadSeen(true);
  }

  const refreshBell = useCallback(() => {
    api.get("/api/bell").then(setBell).catch(() => {});
    api.get("/api/reservations", { query: { mine: true } })
      .then((reservations) => setStale(reservations.filter((reservation) => reservation.stale).length))
      .catch(() => {});
  }, []);

  const setView = useCallback((next: View) => {
    setViewState(next);
    writeViewHash(next);
  }, []);

  // Hash -> view, when the hash changes (back button, pasted link).
  useEffect(() => {
    const sync = () => {
      if (location.hash === "#users") {
        setViewState("users");
      }
      if (location.hash.startsWith("#route=")) {
        setViewState("map");
      }
    };
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, []);

  useEffect(refreshBell, [refreshBell, view]);

  return { view, setView, bell, stale, uploadSeen, refreshBell };
}
