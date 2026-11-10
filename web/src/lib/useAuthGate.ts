import { useCallback, useEffect, useState } from "react";
import { api, ApiError, authEvents, setDevUser } from "@/api/client";
import type { components } from "@/api/schema";

export type Me = components["schemas"]["CurrentUser"];
type Page = "loading" | "login" | "change" | "app" | "error";

function pageFor(user: Me): Page {
  return user.must_change_password ? "change" : "app";
}

// Auth gate: GET /api/me decides. 401 -> Login, must_change_password -> Change password, else the dashboard.
// The api client reports a 401 or a 403 password_change_required from any call,
// so a mid-session change routes too.
export function useAuthGate() {
  const [me, setMe] = useState<Me | null>(null);
  const [page, setPage] = useState<Page>("loading");
  // the user opened Change password from the account menu
  const [voluntary, setVoluntary] = useState(false);

  const loadMe = useCallback(() => {
    api.get("/api/me")
      .then((user) => {
        setMe(user);
        setPage(pageFor(user));
      })
      .catch((error) => {
        const unauthorised = error instanceof ApiError && error.status === 401;
        setPage(unauthorised ? "login" : "error");
      });
  }, []);

  useEffect(() => {
    loadMe();
    const onSignedOut = () => {
      setMe(null);
      setPage("login");
    };
    const onPasswordChange = () => loadMe();
    authEvents.addEventListener("signed-out", onSignedOut);
    authEvents.addEventListener("password-change", onPasswordChange);
    return () => {
      authEvents.removeEventListener("signed-out", onSignedOut);
      authEvents.removeEventListener("password-change", onPasswordChange);
    };
  }, [loadMe]);

  const signOut = async () => {
    setDevUser(null);
    try {
      await api.post("/api/auth/logout");
    } catch {
      // signed out locally either way
    }
    setMe(null);
    setPage("login");
  };

  const signedIn = (user: Me) => {
    setDevUser(null);
    setMe(user);
    setVoluntary(false);
    setPage(pageFor(user));
  };

  const passwordChanged = () => {
    setVoluntary(false);
    setPage("loading");
    loadMe();
  };

  return {
    me,
    page,
    voluntary,
    signOut,
    signedIn,
    passwordChanged,
    openChangePassword: () => setVoluntary(true),
    cancelChangePassword: () => setVoluntary(false),
  };
}
