import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { useCustomerPicker } from "@/components/ChosenBar";
import { Icon } from "@/components/Icon";
import { LossPill } from "@/components/LossCard";
import { db, health } from "@/lib/status";

// Route planner (TASK-051, TASK-076, route loss line of TASK-040). The routes API returns plain dicts, so the shapes live here.
type Span = components["schemas"]["SpanSummary"];
type RouteLoss = components["schemas"]["RouteLoss"];
type Sort = "km" | "free_cores";
type Endpoint = { id: number; name: string; kind: string };
export type RouteSpan = {
  span_id: number; name: string; site_a: string; site_b: string; km: number | null; free_to_reserve: number;
  surveyed: boolean; segment_label: string | null; measured: boolean;
};
export type RouteOption = {
  spans: RouteSpan[]; total_km: number; distance_incomplete: boolean; estimated_db: number | null; fewest_free: number;
  bottleneck_span_id: number; measured_spans: number; total_spans: number; insufficient: boolean; best_match: boolean;
};
type Result = { options: RouteOption[]; message: string | null };
type Errs = Partial<Record<"from" | "to" | "cores_needed" | "form", string>>;

// Shareable selection: #route=<from site id>-<to site id>-<cores needed>-<km|free_cores>-<option index, 0-based>.
const HASH = /^#route=(\d+)-(\d+)-(\d+)-(km|free_cores)-(\d+)$/;
const routeHash = () => {
  const m = HASH.exec(location.hash);
  return m ? { from: +m[1], to: +m[2], cores: m[3], sort: m[4] as Sort, idx: +m[5] } : null;
};

const KIND: Record<string, string> = { data_center: "data centre", toc: "TOC", site: "site", building: "building" };
const kindWord = (k: string | undefined) => KIND[k ?? ""] ?? k ?? "site";
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

const isShort = (s: RouteSpan, need: number) => !s.surveyed || s.free_to_reserve < need;

export function useRoutePlanner(active: boolean, version: number) {
  const [eps, setEps] = useState<Endpoint[]>([]);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [cores, setCores] = useState("2");
  const [sort, setSort] = useState<Sort>("km");
  const [idx, setIdx] = useState<number | null>(null);
  const [spanIdx, setSpanIdx] = useState(0);
  const [epsErr, setEpsErr] = useState(false);
  const [got, setGot] = useState<{ key: string; res: Result | null; errs: Errs } | null>(null);

  // A #route= hash (on load, back button, pasted link) fills the form once the site list is in.
  const epsRef = useRef<Endpoint[]>([]);
  useEffect(() => {
    const apply = () => {
      const h = routeHash(), list = epsRef.current;
      if (!h || !list.length) return;
      const name = (id: number) => list.find((e) => e.id === id)?.name ?? "";
      setFromText(name(h.from)); setToText(name(h.to)); setCores(h.cores); setSort(h.sort); setIdx(h.idx); setSpanIdx(0);
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
  const loading = key != null && !cur;
  const errs: Errs = { ...(epsErr && { form: "Could not load the site list." }), ...(both && need == null && { cores_needed: "Enter a whole number of cores, 1 or more." }), ...cur?.errs };

  const option = idx != null ? res?.options[idx] ?? null : null;
  // Selection -> hash, only while the Find card is in Route mode. Waits while the site list or a restored option loads.
  useEffect(() => {
    if (!active || !eps.length || (idx != null && !res && !cur)) return;
    const h = option && both ? `#route=${fromId}-${toId}-${need}-${sort}-${idx}` : "";
    if (h ? location.hash !== h : location.hash.startsWith("#route=")) history.replaceState(null, "", h || location.pathname + location.search);
  }, [active, eps, idx, res, cur, option, both, fromId, toId, need, sort]);

  const reset = () => { setIdx(null); setSpanIdx(0); };
  return {
    eps, fromText, toText, cores, sort, need, from, to, res, errs, loading, option, idx, spanIdx, setSpanIdx,
    setFrom: (t: string) => { setFromText(t); reset(); },
    setTo: (t: string) => { setToText(t); reset(); },
    setCores: (t: string) => { setCores(t); reset(); },
    setSort: (s: Sort) => { setSort(s); reset(); },
    select: (i: number) => {
      const o = res?.options[i];
      setIdx(i);
      setSpanIdx(Math.max(0, o ? o.spans.findIndex((s) => s.span_id === o.bottleneck_span_id) : 0));
    },
  };
}
export type RoutePlanner = ReturnType<typeof useRoutePlanner>;

const Shape = ({ kind, className = "" }: { kind?: string; className?: string }) =>
  <span aria-hidden className={`rb-sh ${kind === "data_center" ? "dc" : "st"} ${className}`} />;

// ---------- Find card, "Route A to B" ----------
export function RouteForm({ rp }: { rp: RoutePlanner }) {
  const id = useId();
  const [left, setLeft] = useState({ from: false, to: false });
  const need = rp.need ?? 0;
  const pickErr = (k: "from" | "to") => {
    const text = k === "from" ? rp.fromText : rp.toText;
    if (rp.errs[k]) return rp.errs[k];
    return left[k] && text.trim() && !(k === "from" ? rp.from : rp.to) ? "Pick a site from the list." : undefined;
  };
  const picker = (k: "from" | "to", label: string) => {
    const err = pickErr(k);
    const site = k === "from" ? rp.from : rp.to;
    return (
      <div className="grid min-w-0 gap-1">
        <label htmlFor={`${id}-${k}`} className="lbl">{label}</label>
        <div className="relative">
          <Shape kind={site?.kind} className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${site ? "" : "opacity-0"}`} />
          <input id={`${id}-${k}`} list={`${id}-sites`} className="field pl-8" autoComplete="off" placeholder="Type a site"
            value={k === "from" ? rp.fromText : rp.toText} aria-invalid={!!err} aria-describedby={err ? `${id}-${k}-e` : `${id}-${k}-k`}
            onChange={(e) => (k === "from" ? rp.setFrom : rp.setTo)(e.target.value)}
            onFocus={() => setLeft((l) => ({ ...l, [k]: false }))} onBlur={() => setLeft((l) => ({ ...l, [k]: true }))} />
        </div>
        {err ? <p id={`${id}-${k}-e`} className="text-[13px] font-semibold text-red">{err}</p>
          : <p id={`${id}-${k}-k`} className="text-xs text-muted-foreground">{site ? cap(kindWord(site.kind)) : "Data centre or site"}</p>}
      </div>
    );
  };
  const o = rp.res?.options ?? [];
  return (
    <div className="mt-3" data-testid="route-form">
      <datalist id={`${id}-sites`}>
        {rp.eps.map((e) => <option key={e.id} value={e.name} label={cap(kindWord(e.kind))} />)}
      </datalist>
      <div className="grid grid-cols-2 gap-3">{picker("from", "From")}{picker("to", "To")}</div>
      <div className="mt-2 grid gap-1">
        <span className="lbl" id={`${id}-opt`}>Optimise for</span>
        <div role="radiogroup" aria-labelledby={`${id}-opt`} className="grid h-9 grid-cols-2 overflow-hidden rounded-md border border-line">
          {([["km", "Shortest distance"], ["free_cores", "Most free cores"]] as const).map(([v, label], i) => (
            <label key={v} className={`relative flex cursor-pointer items-center justify-center px-2 font-medium whitespace-nowrap has-checked:bg-foreground has-checked:font-semibold has-checked:text-white has-focus-visible:z-10 has-focus-visible:outline-3 has-focus-visible:outline-blue ${i ? "border-l border-line" : ""}`}>
              <input type="radio" name={`${id}-sort`} className="absolute size-px opacity-0" checked={rp.sort === v} onChange={() => rp.setSort(v)} />{label}
            </label>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <label htmlFor={`${id}-need`}>Cores needed per span</label>
        <input id={`${id}-need`} type="number" min={1} step={1} inputMode="numeric" className="field w-24! text-right" value={rp.cores}
          aria-invalid={!!rp.errs.cores_needed} aria-describedby={rp.errs.cores_needed ? `${id}-need-e` : undefined}
          onChange={(e) => rp.setCores(e.target.value)} />
      </div>
      {rp.errs.cores_needed && <p id={`${id}-need-e`} className="mt-1 text-right text-[13px] font-semibold text-red">{rp.errs.cores_needed}</p>}
      {rp.errs.form && <p role="alert" className="mt-2 text-[13px] font-semibold text-red">{rp.errs.form}</p>}

      <div className="mt-3 border-t pt-3" aria-live="polite">
        {!rp.from || !rp.to ? <p className="text-[13px] text-muted-foreground">Choose From and To to see up to 3 route options.</p>
          : rp.loading && !rp.res ? <p className="text-[13px] text-muted-foreground">Finding routes...</p>
          : rp.res && o.length === 0 ? <p className="rounded-md border border-dashed border-line px-4 py-3 text-[13px]"><b className="block font-semibold">{rp.res.message ?? "No route found"}</b>Pick other sites.</p>
          : o.length > 0 && (
            <>
              <p className="lbl mb-1.5">{o.length} {o.length === 1 ? "option" : "options"}, {rp.sort === "km" ? "shortest first" : "most free cores first"}</p>
              <ul aria-label="Route options" className="grid gap-2">
                {o.map((op, i) => <li key={i}><OptionCard op={op} i={i} need={need} pressed={rp.idx === i} onClick={() => rp.select(i)} /></li>)}
              </ul>
            </>
          )}
      </div>
    </div>
  );
}

function OptionCard({ op, i, need, pressed, onClick }: { op: RouteOption; i: number; need: number; pressed: boolean; onClick: () => void }) {
  const bn = op.spans.find((s) => s.span_id === op.bottleneck_span_id)!;
  const short = op.spans.find((s) => isShort(s, need));
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} data-testid="route-option"
      className="block w-full rounded-md border border-l-3 border-border border-l-transparent px-3.5 py-2.5 text-left text-[13px] hover:bg-ground focus-visible:-outline-offset-3 aria-pressed:border-l-blue aria-pressed:bg-blue-bg">
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm"><b className="font-semibold">Option {i + 1}</b>, <b>{op.total_spans}</b> {op.total_spans === 1 ? "span" : "spans"}, <b>{km(op.total_km)}</b> km</span>
        {op.best_match && <span className="pill h-blue">Best match</span>}
      </span>
      {op.distance_incomplete && <span className="block text-muted-foreground">Some spans have no distance</span>}
      <span className="block text-muted-foreground">
        {op.estimated_db == null ? "No dB estimate" : <>Estimated <b className="text-foreground">{db(op.estimated_db)}</b></>}, measured <b className="text-foreground">{op.measured_spans} of {op.total_spans}</b>
      </span>
      {op.insufficient && short ? (
        <span className="mt-0.5 flex items-start gap-1.5 font-semibold text-red">
          <Icon name="fl" className="ic mt-[3px]" />
          <span>{short.surveyed ? <>Lowest free <b>{short.free_to_reserve}</b> on {short.name}, short for {need}</> : <>{short.name} not surveyed, short for {need}</>}</span>
        </span>
      ) : (
        <span className="mt-0.5 block">Lowest free <b>{op.fewest_free}</b>, bottleneck <Icon name="bn" className="ic inline align-[-1px]" /> <b className="font-semibold">{bn.name}</b></span>
      )}
    </button>
  );
}

// ---------- Inspector, route state ----------
export function RouteSummary({ rp, spans, onGo }: { rp: RoutePlanner; spans: Span[] | null; onGo: () => void }) {
  const [all, setAll] = useState(false);
  const op = rp.option;
  if (!op) {
    return (
      <p className="rounded-md border border-dashed border-line px-4 py-5 text-center text-[13px] text-muted-foreground">
        <b className="mb-0.5 block text-sm font-semibold text-foreground">No route selected</b>
        Choose From and To in Find, then pick an option.
      </p>
    );
  }
  const need = rp.need ?? 0;
  const info = (id: number) => spans?.find((s) => s.id === id);
  const bi = op.spans.findIndex((s) => s.span_id === op.bottleneck_span_id);
  const bn = op.spans[bi];
  const h = op.insufficient ? { cls: "h-red", icon: "fl" as const, word: "Short" } : health({ survey_cores: 0, free_to_reserve: op.fewest_free });
  const shorts = op.spans.filter((s) => isShort(s, need));
  const shown = all || rp.spanIdx > 2 ? op.spans : op.spans.slice(0, 3);
  return (
    <div className="flex flex-1 flex-col" data-testid="route-summary">
      <p className="lbl">Route, option {(rp.idx ?? 0) + 1}</p>
      <h3 className="text-2xl leading-[30px] font-bold tracking-tight">{op.spans[0].site_a} to {op.spans[op.spans.length - 1].site_b}</h3>
      <p className="mt-1 text-[13px] text-muted-foreground"><b className="text-foreground">{need}</b> {need === 1 ? "core" : "cores"} needed per span</p>
      <dl className="mt-4 grid grid-cols-3 rounded-md border">
        <div className="p-3"><dt className="lbl">Spans</dt><dd className="text-2xl font-bold">{op.total_spans}</dd></div>
        <div className="border-l p-3"><dt className="lbl">Distance</dt><dd className="text-2xl font-bold">{km(op.total_km)}<small className="ml-1 text-xs font-normal text-muted-foreground">km</small></dd></div>
        <div className="border-l p-3"><dt className="lbl">Lowest free</dt>
          <dd className={`flex flex-wrap items-center gap-x-2 text-2xl font-bold ${h.cls.replace("h-", "v-")}`}>{op.fewest_free}<span className={`pill tracking-normal ${h.cls}`}><Icon name={h.icon} />{h.word}</span></dd>
        </div>
      </dl>
      <p className="mt-2.5 text-[13px] text-muted-foreground">
        Bottleneck <b className="text-foreground">{bn.name}</b>, {bn.free_to_reserve} free{info(bn.span_id)?.survey_cores != null && ` of ${info(bn.span_id)!.survey_cores} surveyed`}.
        {" "}{op.estimated_db == null ? "No loss estimate: a span has no distance." : <>Estimated loss <b className="text-foreground">{db(op.estimated_db)}</b>, {op.measured_spans} of {op.total_spans} spans measured.</>}
        {op.distance_incomplete && op.estimated_db != null && " Some spans have no distance."}
      </p>
      {shorts.length > 0 && (
        <p className="mt-3 flex gap-2 rounded-md border border-l-3 border-red-bd border-l-red bg-red-bg px-3 py-2.5 text-[13px] font-medium text-red">
          <Icon name="fl" className="ic mt-[3px]" />
          <span><b>Not enough free cores</b> on {shorts.map((s) => s.surveyed ? `${s.name} (${s.free_to_reserve} free)` : `${s.name} (not surveyed)`).join(", ")}. Need {need}. Pick another option or lower the cores needed.</span>
        </p>
      )}
      <div className="mt-4 border-t pt-3">
        <div className="lbl">Spans on this route</div>
        <ol>
          {shown.map((s, i) => {
            const sh = isShort(s, need), sp = info(s.span_id);
            return (
              <li key={s.span_id}>
                <button type="button" aria-current={i === rp.spanIdx ? "true" : undefined} onClick={() => rp.setSpanIdx(i)}
                  className="grid min-h-11 w-full grid-cols-[20px_1fr_auto] items-center gap-2 border-b border-l-3 border-b-rule border-l-transparent py-1 pl-2 text-left text-[13px] hover:bg-ground focus-visible:-outline-offset-3 aria-[current]:border-l-blue aria-[current]:bg-blue-bg">
                  <span className="text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">{[sp?.route_type, s.km == null ? "no distance" : `${km(s.km)} km`].filter(Boolean).join(", ")}</span>
                  </span>
                  <span className="flex items-center gap-1.5 pr-1">
                    {sh ? <span className="pill h-red"><Icon name="fl" />{s.surveyed ? "short" : "not surveyed"}</span>
                      : s.span_id === op.bottleneck_span_id && <span className="inline-flex items-center gap-1 text-xs font-semibold"><Icon name="bn" />bottleneck</span>}
                    {s.surveyed && <FreePill n={s.free_to_reserve} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {op.spans.length > shown.length && (
          <button type="button" className="mt-2 font-semibold text-blue underline underline-offset-2 hover:no-underline" onClick={() => setAll(true)}>
            Show {op.spans.length - shown.length} more
          </button>
        )}
      </div>
      <div className="-mx-5 mt-auto border-t px-5 pt-5">
        <button type="button" className="btn w-full" onClick={onGo}>Go to ribbon, table and Reserve</button>
      </div>
    </div>
  );
}

const FreePill = ({ n }: { n: number }) => {
  const h = health({ survey_cores: 0, free_to_reserve: n });
  return <span className={`pill min-w-11 justify-center gap-[5px] ${h.cls}`}><Icon name={h.icon} className="size-2.5" />{h.value}<span className="sr-only"> free, {h.word}</span></span>;
};

// ---------- Bottom section, route state ----------
export function RouteSection({ rp, spans, onDone }: { rp: RoutePlanner; spans: Span[] | null; onDone: () => void }) {
  const op = rp.option!;
  const need = rp.need ?? 0;
  const [loss, setLoss] = useState<RouteLoss | null>(null);
  const ids = op.spans.map((s) => s.span_id).join(",");
  const freeSum = op.spans.reduce((n, s) => n + s.free_to_reserve, 0);
  useEffect(() => {
    let stale = false;
    api.get("/api/loss/route", { query: { span_ids: ids } }).then((r) => !stale && setLoss(r)).catch(() => !stale && setLoss(null));
    return () => { stale = true; };
  }, [ids, freeSum]);
  const info = (id: number) => spans?.find((s) => s.id === id);
  const surveyedSum = op.spans.reduce((n, s) => n + (info(s.span_id)?.survey_cores ?? 0), 0);
  const first = op.spans[0].site_a, last = op.spans[op.spans.length - 1].site_b;
  return (
    <section className="card col-span-12" aria-labelledby="route-h" data-testid="route-section">
      <div className="card-h items-center">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1">
          <h2 id="route-h" tabIndex={-1} className="outline-offset-4">Route <span className="font-normal text-muted-foreground">option {(rp.idx ?? 0) + 1}, {first} to {last}</span></h2>
          <p className="flex gap-4 text-[13px] text-muted-foreground">
            <span><b className="mr-1 text-base text-foreground">{op.total_spans}</b>spans</span>
            <span><b className="mr-1 text-base text-foreground">{km(op.total_km)}</b>km{op.distance_incomplete && " (some spans have no distance)"}</span>
            <span><b className="mr-1 text-base text-foreground">{op.fewest_free}</b>lowest free</span>
          </p>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6">
        <div className="min-w-0">
          <Ribbon rp={rp} op={op} need={need} spans={spans} />
          <ul className="mt-3.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-xs text-muted-foreground" aria-label="Ribbon key">
            <li className="flex items-center gap-1.5"><span className="rb-sh dc" aria-hidden />Data centre</li>
            <li className="flex items-center gap-1.5"><span className="rb-sh st scale-75" aria-hidden />Other site</li>
            <li className="flex items-center gap-1.5"><span className="rb-ll" aria-hidden />Trunk</li>
            <li className="flex items-center gap-1.5"><span className="rb-ll m" aria-hidden />Metro</li>
            <li className="flex items-center gap-1.5"><span className="rb-ll b" aria-hidden />Bespoke</li>
            <li className="flex items-center gap-1.5"><span className="rb-sw" aria-hidden><Icon name="bn" /></span>Bottleneck: fewest free on route</li>
            <li className="flex items-center gap-1.5"><span className="rb-sw x hatch-red" aria-hidden><Icon name="fl" /></span>Short: fewer free than needed, or not surveyed</li>
          </ul>
        </div>
        <ReserveBox key={ids} op={op} need={need} onDone={onDone} />
      </div>

      <div data-testid="route-loss" className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border px-4 py-3 text-[13px]">
        <span className="lbl">Route loss</span>
        {!loss ? <span className="text-muted-foreground">Loading loss...</span> : (
          <>
            <span>Total calculated <b>{loss.total_calculated_db == null ? "Not every span has a distance" : db(loss.total_calculated_db)}</b></span>
            <span>Total measured <b>{loss.total_measured_db == null ? "Not all spans measured" : db(loss.total_measured_db)}</b></span>
            <span className="flex items-center gap-2">Overall level {loss.level ? <LossPill l={{ level: loss.level, deviation_pct: null }} /> : <b>-</b>}</span>
            <span className="text-muted-foreground">Worst span sets the level. {op.measured_spans} of {op.total_spans} spans measured.</span>
          </>
        )}
      </div>

      <table className="tbl mt-4" data-testid="route-table">
        <caption className="sr-only">Spans on this route, in travel order, with free cores and loss</caption>
        <thead><tr>
          <th scope="col">#</th><th scope="col">Span</th><th scope="col">From to</th><th scope="col" className="text-right!">km</th>
          <th scope="col" className="text-right!">Surveyed</th><th scope="col" className="text-right!">Free</th>
          <th scope="col" className="text-right!">Calculated</th><th scope="col" className="text-right!">Measured</th><th scope="col" className="pr-0!">Loss level</th>
        </tr></thead>
        <tbody>
          {op.spans.map((s, i) => {
            const sh = isShort(s, need), l = loss?.spans[i], sel = i === rp.spanIdx;
            return (
              <tr key={s.span_id} aria-selected={sel} className={sel ? "bg-blue-bg [&>td:first-child]:shadow-[inset_3px_0_0_var(--blue)]" : ""}>
                <td className="pl-2">{i + 1}</td>
                <th scope="row" className="text-left">
                  <button type="button" className="text-left font-semibold underline decoration-line underline-offset-4 hover:text-blue" onClick={() => rp.setSpanIdx(i)}>{s.name}</button>
                  {s.segment_label && <span className="block text-xs font-normal text-muted-foreground">Segment {s.segment_label}</span>}
                </th>
                <td>{s.site_a} to {s.site_b}</td>
                <td className="text-right font-semibold whitespace-nowrap">{s.km == null ? "No distance" : km(s.km)}</td>
                <td className="text-right">{info(s.span_id)?.survey_cores ?? "Not surveyed"}</td>
                <td className="text-right whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    {sh ? <span className="pill h-red"><Icon name="fl" />{s.surveyed ? "short" : "not surveyed"}</span>
                      : s.span_id === op.bottleneck_span_id && <span className="inline-flex items-center gap-1 text-xs font-semibold"><Icon name="bn" />bottleneck</span>}
                    <b className={sh ? "text-red" : ""}>{s.surveyed ? s.free_to_reserve : "-"}</b>
                  </span>
                </td>
                <td className="text-right whitespace-nowrap">{!l ? "-" : l.calculated_db == null ? "No distance" : db(l.calculated_db)}</td>
                <td className="text-right whitespace-nowrap">{!l ? "-" : l.measured_db == null ? <span className="text-muted-foreground">Not measured</span> : db(l.measured_db)}</td>
                <td className="pr-0">{l?.level ? <LossPill l={l} /> : <span className="text-muted-foreground">-</span>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="font-bold [&_td]:h-12 [&_td]:border-t [&_td]:border-foreground [&_td]:pr-4">
          <tr>
            <td colSpan={3}>Total, {op.total_spans} {op.total_spans === 1 ? "span" : "spans"}</td>
            <td className="text-right">{km(op.total_km)}{op.distance_incomplete && "+"}</td>
            <td className="text-right">{surveyedSum}</td>
            <td className="text-right whitespace-nowrap">lowest free {op.fewest_free}</td>
            <td className="text-right whitespace-nowrap">{loss?.total_calculated_db == null ? "Not every span has a distance" : db(loss.total_calculated_db)}</td>
            <td className="text-right">{loss?.total_measured_db == null ? "Not all spans measured" : db(loss.total_measured_db)}</td>
            <td className="pr-0!">{loss?.level ? <LossPill l={{ level: loss.level, deviation_pct: null }} /> : "-"}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

// Sites as nodes left to right, spans as links. Wraps to more rows by width; the first node of a later row says "cont.".
const NODE = 88, MIN_LINK = 150;
function Ribbon({ rp, op, need, spans }: { rp: RoutePlanner; op: RouteOption; need: number; spans: Span[] | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = op.spans.length;
  const k = Math.min(n, Math.max(1, Math.floor(((w || 800) - NODE) / (NODE + MIN_LINK))));
  const info = (id: number) => spans?.find((s) => s.id === id);
  const kind = (name: string) => rp.eps.find((e) => e.name === name)?.kind;
  const sites = [op.spans[0].site_a, ...op.spans.map((s) => s.site_b)];
  const label = (s: RouteSpan) => {
    const sp = info(s.span_id);
    return [`Span ${s.name}`, sp?.route_type, s.km == null ? "no distance" : `${km(s.km)} km`,
      s.surveyed ? `${s.free_to_reserve}${sp?.survey_cores != null ? ` of ${sp.survey_cores}` : ""} cores free` : "not surveyed",
      s.span_id === op.bottleneck_span_id && "bottleneck", isShort(s, need) && `short, need ${need}`].filter(Boolean).join(", ");
  };
  const move = (e: KeyboardEvent) => {
    const to = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const i = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : to != null ? Math.min(n - 1, Math.max(0, rp.spanIdx + to)) : null;
    if (i == null) return;
    e.preventDefault();
    rp.setSpanIdx(i);
    ref.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus();
  };
  const rows: [number, number][] = [];
  for (let i = 0; i < n; i += k) rows.push([i, Math.min(n, i + k)]);
  return (
    <div ref={ref}>
      <div className="grid gap-3.5" role="group" aria-label="Route ribbon. Arrow keys move between spans." onKeyDown={move} data-testid="ribbon">
        {rows.map(([a, b], ri) => {
          const cnt = b - a;
          // Region bands behind the links: consecutive spans with the same region share one band.
          const zones: { reg: string; s: number; e: number }[] = [];
          for (let t = 0; t < cnt; t++) {
            const reg = info(op.spans[a + t].span_id)?.region ?? "";
            if (zones.length && zones[zones.length - 1].reg === reg) zones[zones.length - 1].e = t;
            else zones.push({ reg, s: t, e: t });
          }
          return (
            <div key={ri} className="rb-row" style={{ gridTemplateColumns: `var(--n) repeat(${k}, minmax(0,1fr) minmax(0,1fr) var(--n))` }}>
              {zones.filter((z) => z.reg).map((z, zi) => (
                <div key={zi} aria-hidden className={`rb-zone ${zi % 2 ? "z1" : ""}`}
                  style={{ gridColumn: `${z.s === 0 ? 1 : 2 + 3 * z.s} / ${z.e === cnt - 1 ? 3 * cnt + 2 : 3 * z.e + 4}` }}>
                  <span>{z.reg}</span>
                </div>
              ))}
              {Array.from({ length: cnt + 1 }, (_, t) => {
                const gi = a + t, name = sites[gi];
                const fl = gi === 0 ? "From" : gi === n ? "To" : t === 0 ? "cont." : "";
                return (
                  <div key={`n${t}`} aria-hidden className={`rb-node ${gi === 0 || gi === n ? "end" : ""} ${t === 0 && ri > 0 ? "again" : ""}`} style={{ gridColumn: 1 + 3 * t }}>
                    <span className="fl">{fl}</span><Shape kind={kind(name)} /><span className="cd">{name}</span>
                  </div>
                );
              })}
              {Array.from({ length: cnt }, (_, t) => {
                const gi = a + t, s = op.spans[gi], sp = info(s.span_id), sh = isShort(s, need);
                const h = health({ survey_cores: s.surveyed ? 0 : null, free_to_reserve: s.free_to_reserve });
                const of = sp?.survey_cores;
                return (
                  <button key={`l${t}`} type="button" data-i={gi} aria-pressed={gi === rp.spanIdx} tabIndex={gi === rp.spanIdx ? 0 : -1} aria-label={label(s)}
                    className={`rb-lk ${sp?.route_type ?? ""} ${sh ? "short" : ""}`} style={{ gridColumn: `${2 + 3 * t} / span 2` }} onClick={() => rp.setSpanIdx(gi)}>
                    <span className="flag">{s.span_id === op.bottleneck_span_id && <><Icon name="bn" className="size-[11px]" />Bottleneck</>}</span>
                    <span className="lab" title={s.name}>{s.name}</span>
                    <span className="ln" />
                    <span className="km">{s.km == null ? "no distance" : `${km(s.km)} km`}</span>
                    <span className={`rb-fb ${sh ? "hatch-red" : ""}`} data-h={h.cls}>
                      <span className="v">{!sh && <Icon name={h.icon} className={`size-[11px] ${h.cls.replace("h-", "v-")}`} />}<b>{s.surveyed ? s.free_to_reserve : "-"}</b>free</span>
                      {sh ? <span className="w"><Icon name="fl" className="size-[11px]" />{s.surveyed ? "short" : "not surveyed"}</span>
                        : <span>{of != null ? `of ${of}` : "free to reserve"}</span>}
                      <span className="mini"><i style={{ width: `${of ? Math.min(100, (100 * s.free_to_reserve) / of) : sh ? 0 : 100}%` }} /></span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <ol className="sr-only" aria-label="Route as text">
        {sites.map((name, i) => (
          <li key={i}>Site {name}, {kindWord(kind(name))}{i < n && `; then ${label(op.spans[i])}`}</li>
        ))}
      </ol>
    </div>
  );
}

function ReserveBox({ op, need, onDone }: { op: RouteOption; need: number; onDone: () => void }) {
  const id = useId();
  const [date, setDate] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const { customer, field, warning } = useCustomerPicker((text) => setMsg({ text, ok: false }));
  const short = op.spans.find((s) => isShort(s, need));
  const total = need * op.total_spans;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!customer || short || !need) return;
    setBusy(true);
    setMsg(null);
    try {
      const p = await api.get("/api/routes/pick", { query: { span_ids: op.spans.map((s) => s.span_id), cores_needed: need } }) as unknown as
        { spans: { name: string; cores: { number: number }[] }[]; core_ids: number[] };
      const r = await api.post("/api/reservations", { body: { customer_id: customer.id, planned_date: date || null, cores: p.core_ids } });
      setMsg({ ok: true, text: `Request #${r.id} sent (${r.status}): ${p.spans.map((s) => `${s.name} cores ${s.cores.map((c) => c.number).join(", ")}`).join("; ")}. Nothing is reserved until an admin approves.` });
      setTried(false);
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, "Reserve failed. Try again.") + (err instanceof ApiError && err.status === 409 ? " The route is shown again with fresh counts." : "") });
      if (err instanceof ApiError && err.status === 409) onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="rounded-md border bg-[#f7f8fa] p-4" aria-labelledby={`${id}-h`} data-testid="route-reserve">
      <h3 id={`${id}-h`} className="text-sm font-semibold">Reserve on this route</h3>
      <p className="mt-1.5 text-[13px] text-muted-foreground">
        <b className="text-foreground">{need}</b> {need === 1 ? "core" : "cores"} on each of <b className="text-foreground">{op.total_spans}</b> spans, <b className="text-foreground">{total}</b> in total. Cores are assigned from the first free cores on each span.
      </p>
      <form className="mt-3 grid gap-3" onSubmit={submit} noValidate>
        {field}
        <label className="grid gap-1"><span className="lbl">Planned date</span>
          <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-p w-full" disabled={busy || !!short} aria-describedby={short ? `${id}-why` : undefined}>Reserve on this route</button>
      </form>
      {short && (
        <p id={`${id}-why`} className="mt-3 flex gap-2 rounded-md border border-l-3 border-red-bd border-l-red bg-red-bg px-3 py-2.5 text-[13px] text-red">
          <Icon name="fl" className="ic mt-[3px]" />
          <span><b>Reserve is off:</b> {short.surveyed ? `${short.name} has ${short.free_to_reserve} free, fewer than the ${need} needed.` : `${short.name} is not surveyed, so it cannot be booked.`} Pick another option or lower the cores needed.</span>
        </p>
      )}
      {warning}
      {tried && !customer && <p role="alert" className="mt-2.5 text-[13px] font-bold text-red">Choose a customer before submitting.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2.5 text-[13px] ${msg.ok ? "font-semibold" : "font-bold text-red"}`}>{msg.text}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Goes to an admin for approval.</p>
    </aside>
  );
}
