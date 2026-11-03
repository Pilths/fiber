import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, errorText } from "@/api/client";
import { Icon } from "@/components/Icon";
import { db, health } from "@/lib/status";

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
    eps, fromText, toText, need, from, to, res, errs, option, idx, sort, setSort, coresText: cores, setCores,
    setFrom: (t: string) => { setFromText(t); setIdx(null); },
    setTo: (t: string) => { setToText(t); setIdx(null); },
    select: setIdx,
  };
}
export type RoutePlanner = ReturnType<typeof useRoutePlanner>;

// "Route A to B" panel beside the map (prototype 9e): sites, cores needed, Find route, sort, then the options.
// Find route picks the best (first) option; the options below show all.
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
  const none = rp.idx != null && rp.res?.options.length === 0;
  const bad = err ?? rp.errs.from ?? rp.errs.to ?? rp.errs.cores_needed ?? rp.errs.form ?? (none ? rp.res?.message ?? "No route found" : null);
  return (
    <section className="card absolute inset-0 flex flex-col overflow-auto" aria-labelledby="route-h">
      <h2 id="route-h" className="card-title mb-3">Route A to B</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label><span className="lbl">Route A</span>
          <input id="route-a" className="field" list="route-sites" value={rp.fromText} onChange={(e) => { setErr(null); rp.setFrom(e.target.value); }} autoComplete="off" /></label>
        <div>
          {/* Swap sits on Route B's label line so every field keeps the panel's full width. */}
          <div className="flex items-end justify-between">
            <label htmlFor="route-b" className="lbl">Route B</label>
            <button type="button" className="mb-1 cursor-pointer text-body font-semibold text-blue hover:underline" onClick={swap} aria-label="Swap A and B">&#8645; Swap</button>
          </div>
          <input id="route-b" className="field" list="route-sites" value={rp.toText} onChange={(e) => { setErr(null); rp.setTo(e.target.value); }} autoComplete="off" />
        </div>
        <label><span className="lbl">Cores needed</span>
          <input type="number" min={1} inputMode="numeric" className="field" value={rp.coresText} onChange={(e) => rp.setCores(e.target.value)} /></label>
        <button type="submit" className="btn btn-p w-full border-blue! bg-blue! hover:brightness-95" disabled={!rp.eps.length}>Find route</button>
        <div role="radiogroup" aria-label="Optimise for" className="grid h-9 grid-cols-2 overflow-hidden rounded-md border border-line">
          {([["km", "Shortest distance"], ["free_cores", "Most free cores"]] as const).map(([v, label], i) => (
            <label key={v} className={`relative flex cursor-pointer items-center justify-center px-2 font-medium whitespace-nowrap has-checked:bg-foreground has-checked:font-semibold has-checked:text-white has-focus-visible:z-10 has-focus-visible:outline-3 has-focus-visible:outline-blue ${i ? "border-l border-line" : ""}`}>
              <input type="radio" name="route-sort" className="absolute size-px opacity-0" checked={rp.sort === v} onChange={() => rp.setSort(v)} />{label}
            </label>
          ))}
        </div>
        {bad && <p role="status" data-testid="route-found" className="font-semibold text-red">{bad}</p>}
        <datalist id="route-sites">{rp.eps.map((e) => <option key={e.id} value={e.name} />)}</datalist>
      </form>
      <RouteOptions rp={rp} />
    </section>
  );
}

// Up to 3 options under Find route; a click draws that option on the map and the diagram.
function RouteOptions({ rp }: { rp: RoutePlanner }) {
  const o = rp.res?.options ?? [];
  if (rp.idx == null || !o.length) return null;
  const need = rp.need ?? 1;
  return (
    <section className="mt-3" aria-label="Route options">
      <ul aria-label="Route options" className="flex flex-col gap-2">
        {o.map((op, i) => {
          const short = op.insufficient ? op.segments.find((s) => isShort(s, need)) : undefined;
          const on = rp.idx === i;
          return (
            <li key={i}>
              <button type="button" aria-pressed={on} onClick={() => rp.select(i)} data-testid="route-option"
                className="flex w-full items-start gap-2.5 rounded-md border border-line px-3 py-2.5 text-left text-body hover:bg-ground focus-visible:-outline-offset-3 aria-pressed:border-blue aria-pressed:bg-blue-bg">
                <span aria-hidden className={`mt-[3px] grid size-4 flex-none place-items-center rounded-full border-2 bg-white ${on ? "border-blue" : "border-line"}`}>
                  {on && <span className="size-2 rounded-full bg-blue" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <b className="text-sm font-semibold">Option {i + 1}</b>
                    {op.best_match && <span className="pill h-blue">Best match</span>}
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2">
                    <span>{op.total_segments} {op.total_segments === 1 ? "segment" : "segments"}, {totalKm(op)} km</span>
                    <span className={`pill ${health({ survey_cores: 1, free_to_reserve: op.fewest_free }).cls}`}>{op.fewest_free} free</span>
                  </span>
                  <span className="block">Calculated loss {op.estimated_db == null ? "-" : db(op.estimated_db)}</span>
                  {short && (
                    <span className="mt-0.5 flex items-start gap-1.5 font-semibold text-red" data-testid="route-short">
                      <Icon name="fl" className="ic mt-[3px]" /><span>{shortText(short, need)}</span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
