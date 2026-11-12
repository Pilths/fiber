import { useEffect, useRef, useState } from "react";
import { api, ApiError, errorText } from "@/api/client";

// Site A to B on Inventory (TASK-051, TASK-076). The routes API returns plain dicts, so the shapes live here.
export type Sort = "km" | "free_cores";
export type Endpoint = { id: number; name: string; kind: string };
export type RouteSegment = {
  segment_id: number;
  name: string;
  site_a: string;
  site_b: string;
  km: number | null;
  free_to_reserve: number;
  surveyed: boolean;
  route_label: string | null;
  measured: boolean;
};
export type RouteOption = {
  segments: RouteSegment[];
  total_km: number;
  distance_incomplete: boolean;
  estimated_db: number | null;
  measured_segments: number;
  total_segments: number;
  insufficient: boolean;
  best_match: boolean;
  fewest_free: number;
};
type Result = { options: RouteOption[]; message: string | null };
export type FieldErrors = Partial<Record<"from" | "to" | "cores_needed" | "form", string>>;
type Fetched = { key: string; result: Result | null; errors: FieldErrors };

// Shareable selection:
// #route=<from site id>-<to site id>-<cores needed>-<km|free_cores>-<option index, 0-based>.
const HASH = /^#route=(\d+)-(\d+)-(\d+)-(km|free_cores)-(\d+)$/;

function readRouteHash() {
  const match = HASH.exec(location.hash);
  if (!match) {
    return null;
  }
  return {
    from: Number(match[1]),
    to: Number(match[2]),
    cores: match[3],
    sort: match[4] as Sort,
    index: Number(match[5]),
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// 422 detail [{loc: ["query", field], msg}] -> inline message per field.
function fieldErrors(error: unknown): FieldErrors {
  const detail = error instanceof ApiError ? (error.detail as { detail?: unknown } | null)?.detail : null;
  if (!Array.isArray(detail)) {
    return { form: errorText(error, "Could not load routes. Try again.") };
  }
  const out: FieldErrors = {};
  for (const item of detail as { loc?: unknown[]; msg?: string }[]) {
    const field = String(item.loc?.[1] ?? "form") as keyof FieldErrors;
    out[field] ??= capitalise(item.msg ?? "Not valid");
  }
  return out;
}

function findSite(sites: Endpoint[], typed: string): Endpoint | null {
  const wanted = typed.trim().toLowerCase();
  return sites.find((site) => site.name.toLowerCase() === wanted) ?? null;
}

// Selection -> #route= hash while Inventory shows; an empty selection removes a #route= hash.
function writeRouteHash(hash: string) {
  if (hash) {
    if (location.hash !== hash) {
      history.replaceState(null, "", hash);
    }
    return;
  }
  if (location.hash.startsWith("#route=")) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

export function useRoutePlanner(active: boolean, version: number) {
  const [sites, setSites] = useState<Endpoint[]>([]);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [coresText, setCores] = useState("1");
  const [sort, setSort] = useState<Sort>("km");
  const [index, setIndex] = useState<number | null>(null);
  const [sitesFailed, setSitesFailed] = useState(false);
  const [fetched, setFetched] = useState<Fetched | null>(null);

  // A #route= hash (on load, back button, pasted link) fills the search once the site list is in.
  const sitesRef = useRef<Endpoint[]>([]);
  useEffect(() => {
    const applyHash = () => {
      const hash = readRouteHash();
      const list = sitesRef.current;
      if (!hash || !list.length) {
        return;
      }
      const nameOf = (id: number) => list.find((site) => site.id === id)?.name ?? "";
      setFromText(nameOf(hash.from));
      setToText(nameOf(hash.to));
      setCores(hash.cores);
      setSort(hash.sort);
      setIndex(hash.index);
    };
    let live = true;
    api.get("/api/routes/endpoints")
      .then((loaded) => {
        if (!live) {
          return;
        }
        sitesRef.current = loaded as unknown as Endpoint[];
        setSites(sitesRef.current);
        applyHash();
      })
      .catch(() => setSitesFailed(true));
    addEventListener("hashchange", applyHash);
    return () => {
      live = false;
      removeEventListener("hashchange", applyHash);
    };
  }, []);

  const from = findSite(sites, fromText);
  const to = findSite(sites, toText);
  const fromId = from?.id;
  const toId = to?.id;
  const need = /^\d+$/.test(coresText.trim()) ? Number(coresText) : null;
  const both = fromId != null && toId != null;
  const key = both && need != null ? `${fromId}-${toId}-${need}-${sort}` : null;

  useEffect(() => {
    if (!key) {
      return;
    }
    let stale = false;
    const query = { from: fromId!, to: toId!, cores_needed: need!, sort };
    api.get("/api/routes", { query })
      .then((loaded) => {
        if (!stale) {
          setFetched({ key, result: loaded as unknown as Result, errors: {} });
        }
      })
      .catch((error) => {
        if (!stale) {
          setFetched({ key, result: null, errors: fieldErrors(error) });
        }
      });
    return () => {
      stale = true;
    };
  }, [key, version]); // eslint-disable-line react-hooks/exhaustive-deps -- key covers from, to, need, sort

  // a version refetch keeps showing the last result
  const current = key != null && fetched?.key === key ? fetched : null;
  const result = current?.result ?? null;
  const listError = sitesFailed && { form: "Could not load the site list." };
  const errors: FieldErrors = { ...listError, ...current?.errors };
  const option = index != null ? result?.options[index] ?? null : null;

  // Waits while the site list or a restored option loads.
  useEffect(() => {
    const waitingForOption = index != null && !result && !current;
    if (!active || !sites.length || waitingForOption) {
      return;
    }
    const hash = option && both ? `#route=${fromId}-${toId}-${need}-${sort}-${index}` : "";
    writeRouteHash(hash);
  }, [active, sites, index, result, current, option, both, fromId, toId, need, sort]);

  const setFrom = (text: string) => {
    setFromText(text);
    setIndex(null);
  };
  const setTo = (text: string) => {
    setToText(text);
    setIndex(null);
  };
  // The "Clear route" link: the route and the two site boxes, so the next search starts empty.
  const reset = () => {
    setIndex(null);
    setFromText("");
    setToText("");
  };

  return {
    clear: () => setIndex(null),
    reset,
    sites,
    fromText,
    toText,
    need,
    from,
    to,
    result,
    errors,
    option,
    index,
    sort,
    setSort,
    coresText,
    setCores,
    setFrom,
    setTo,
    select: setIndex,
  };
}

export type RoutePlanner = ReturnType<typeof useRoutePlanner>;
