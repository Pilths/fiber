import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, errorText } from "@/api/client";
import { Icon } from "@/components/Icon";
import { db } from "@/lib/status";

// Route A to B on Inventory (TASK-051, TASK-076). The routes API returns plain dicts, so the shapes live here.
type Sort = "km" | "free_cores";
type Endpoint = { id: number; name: string; kind: string };
export type RouteSegment = {
  segment_id: number; name: string; site_a: string; site_b: string; km: number | null; free_to_reserve: number;
  surveyed: boolean; route_label: string | null; measured: boolean;
};
export type RouteOption = {
  segments: RouteSegment[]; total_km: number; distance_incomplete: boolean; estimated_db: number | null;
  measured_segments: number; total_segments: number; insufficient: boolean; best_match: boolean; fewest_free: number;
};
type Result = { options: RouteOption[]; message: string | null };
type Errs = Partial<Record<"from" | "to" | "cores_needed" | "form", string>>;

// Shareable selection: #route=<from site id>-<to site id>-<cores needed>-<km|free_cores>-<option index, 0-based>.
const HASH = /^#route=(\d+)-(\d+)-(\d+)-(km|free_cores)-(\d+)$/;
const routeHash = () => {
  const m = HASH.exec(location.hash);
  return m ? { from: +m[1], to: +m[2], cores: m[3], sort: m[4] as Sort, idx: +m[5] } : null;
};

const km = (n: number) => `${Number(n.toFixed(1))}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// 422 detail [{loc: ["query", field], msg}] -> inline message per field.
function fieldErrors(e: unknown): Errs {
  const d = e instanceof ApiError ? (e.detail as { detail?: unknown } | null)?.detail : null;
  if (!Array.isArray(d)) return { form: errorText(e, "Could not load routes. Try again.") };
  const out: Errs = {};
  for (const x of d as { loc?: unknown[]; msg?: string }[]) {
    const f = String(x.loc?.[1] ?? "form") as keyof Errs;
    out[f] ??= cap(x.msg ?? "Not valid");
  }
  return out;
}

const isShort = (s: RouteSegment, need: number) => !s.surveyed || s.free_to_reserve < need;
const shortText = (s: RouteSegment, need: number) =>
  s.surveyed ? `Not enough free cores on ${s.name}: ${s.free_to_reserve} free, ${need} needed` : `${s.name} is not surveyed`;
const totalKm = (op: RouteOption) => `${km(op.total_km)}${op.distance_incomplete ? "+" : ""}`;

export function useRoutePlanner(active: boolean, version: number) {
  const [eps, setEps] = useState<Endpoint[]>([]);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [cores, setCores] = useState("1");
  const [sort, setSort] = useState<Sort>("km");
  const [idx, setIdx] = useState<number | null>(null);
  const [epsErr, setEpsErr] = useState(false);
  const [got, setGot] = useState<{ key: string; res: Result | null; errs: Errs } | null>(null);

  // A #route= hash (on load, back button, pasted link) fills the search once the site list is in.
  const epsRef = useRef<Endpoint[]>([]);
  useEffect(() => {
    const apply = () => {
      const h = routeHash(), list = epsRef.current;
      if (!h || !list.length) return;
      const name = (id: number) => list.find((e) => e.id === id)?.name ?? "";
      setFromText(name(h.from)); setToText(name(h.to)); setCores(h.cores); setSort(h.sort); setIdx(h.idx);
    };
    let live = true;
    api.get("/api/routes/endpoints").then((r) => {
      if (!live) return;
      epsRef.current = r as unknown as Endpoint[];
      setEps(epsRef.current);
      apply();
    }).catch(() => setEpsErr(true));
    addEventListener("hashchange", apply);
    return () => { live = false; removeEventListener("hashchange", apply); };
  }, []);

  const site = (t: string) => eps.find((e) => e.name.toLowerCase() === t.trim().toLowerCase()) ?? null;
  const from = site(fromText), to = site(toText);
  const fromId = from?.id, toId = to?.id;
  const need = /^\d+$/.test(cores.trim()) ? Number(cores) : null;
  const both = fromId != null && toId != null;
  const key = both && need != null ? `${fromId}-${toId}-${need}-${sort}` : null;

  useEffect(() => {
    if (!key) return;
    let stale = false;
    api.get("/api/routes", { query: { from: fromId!, to: toId!, cores_needed: need!, sort } })
      .then((r) => !stale && setGot({ key, res: r as unknown as Result, errs: {} }))
      .catch((e) => !stale && setGot({ key, res: null, errs: fieldErrors(e) }));
    return () => { stale = true; };
  }, [key, version]); // eslint-disable-line react-hooks/exhaustive-deps -- key covers from, to, need, sort

  const cur = key != null && got?.key === key ? got : null; // a version refetch keeps showing the last result
  const res = cur?.res ?? null;
  const errs: Errs = { ...(epsErr && { form: "Could not load the site list." }), ...cur?.errs };

  const option = idx != null ? res?.options[idx] ?? null : null;
  // Selection -> hash while Inventory shows. Waits while the site list or a restored option loads.
  useEffect(() => {
    if (!active || !eps.length || (idx != null && !res && !cur)) return;
    const h = option && both ? `#route=${fromId}-${toId}-${need}-${sort}-${idx}` : "";
    if (h ? location.hash !== h : location.hash.startsWith("#route=")) history.replaceState(null, "", h || location.pathname + location.search);
  }, [active, eps, idx, res, cur, option, both, fromId, toId, need, sort]);

  return {
    clear: () => setIdx(null),
    eps, fromText, toText, need, from, to, res, errs, option, idx,
    setFrom: (t: string) => { setFromText(t); setIdx(null); },
    setTo: (t: string) => { setToText(t); setIdx(null); },
    select: setIdx,
  };
}
export type RoutePlanner = ReturnType<typeof useRoutePlanner>;

// Search bar above the map: Route A, swap, Route B. Search picks the best (first) option; the options card shows all.
export function RouteSearch({ rp }: { rp: RoutePlanner }) {
  const [err, setErr] = useState<string | null>(null);
  const check = (a: typeof rp.from, b: typeof rp.to) =>
    !a || !b ? "Choose sites from the list" : a.id === b.id ? "Choose two different sites" : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const x = check(rp.from, rp.to);
    setErr(x);
    if (!x) rp.select(0);
  };
  const swap = () => {
    const a = rp.fromText, picked = rp.idx != null;
    rp.setFrom(rp.toText); rp.setTo(a);
    if (picked) rp.select(0);
  };
  const op = rp.option, none = rp.idx != null && rp.res?.options.length === 0;
  const bad = err ?? rp.errs.from ?? rp.errs.to ?? rp.errs.cores_needed ?? rp.errs.form ?? (none ? rp.res?.message ?? "No route found" : null);
  return (
    <section className="card col-span-12 px-4 py-3" aria-label="Route search">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="w-56"><span className="lbl">Route A</span>
          <input id="route-a" className="field" list="route-sites" value={rp.fromText} onChange={(e) => { setErr(null); rp.setFrom(e.target.value); }} autoComplete="off" /></label>
        <button type="button" className="btn px-3" onClick={swap} aria-label="Swap A and B">&#8646;</button>
        <label className="w-56"><span className="lbl">Route B</span>
          <input className="field" list="route-sites" value={rp.toText} onChange={(e) => { setErr(null); rp.setTo(e.target.value); }} autoComplete="off" /></label>
        <button type="submit" className="btn btn-p" disabled={!rp.eps.length}>Search</button>
        {(bad || op) && (
          <span role="status" data-testid="route-found" className={`self-center font-semibold ${bad ? "text-red" : "text-foreground"}`}>
            {bad ?? `${op!.segments.length} ${op!.segments.length === 1 ? "segment" : "segments"}, ${km(op!.total_km)} km`}
          </span>
        )}
        <datalist id="route-sites">{rp.eps.map((e) => <option key={e.id} value={e.name} />)}</datalist>
      </form>
    </section>
  );
}

// Up to 3 options under the search once a route is found; a click draws that option on the map and the diagram.
export function RouteOptions({ rp }: { rp: RoutePlanner }) {
  const o = rp.res?.options ?? [];
  if (rp.idx == null || !o.length) return null;
  const need = rp.need ?? 1;
  return (
    <section className="card col-span-12 px-4 py-3" aria-label="Route options">
      <ul aria-label="Route options" className="grid grid-cols-3 gap-3">
        {o.map((op, i) => {
          const short = op.insufficient ? op.segments.find((s) => isShort(s, need)) : undefined;
          return (
            <li key={i}>
              <button type="button" aria-pressed={rp.idx === i} onClick={() => rp.select(i)} data-testid="route-option"
                className="block h-full w-full rounded-md border border-l-3 border-border border-l-transparent px-3.5 py-2.5 text-left text-body hover:bg-ground focus-visible:-outline-offset-3 aria-pressed:border-l-blue aria-pressed:bg-blue-bg">
                <span className="mb-0.5 flex items-start justify-between gap-2">
                  <b className="text-sm font-semibold">Option {i + 1}</b>
                  {op.best_match && <span className="pill h-blue">Best match</span>}
                </span>
                <span className="block">
                  {op.total_segments} {op.total_segments === 1 ? "segment" : "segments"}, {totalKm(op)} km, <b className="font-semibold">{op.fewest_free}</b> free
                </span>
                <span className="block">Calculated loss {op.estimated_db == null ? "-" : db(op.estimated_db)}</span>
                {short && (
                  <span className="mt-0.5 flex items-start gap-1.5 font-semibold text-red" data-testid="route-short">
                    <Icon name="fl" className="ic mt-[3px]" /><span>{shortText(short, need)}</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
