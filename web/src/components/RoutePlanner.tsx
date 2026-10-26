import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { useCustomerPicker } from "@/components/ChosenBar";
import { Icon } from "@/components/Icon";
import { db } from "@/lib/status";

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
  spans: RouteSpan[]; total_km: number; distance_incomplete: boolean; estimated_db: number | null;
  measured_spans: number; total_spans: number; insufficient: boolean; best_match: boolean;
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
const shortText = (s: RouteSpan, need: number) =>
  s.surveyed ? `Not enough free cores on ${s.name}: ${s.free_to_reserve} free, ${need} needed` : `${s.name} is not surveyed`;
const totalKm = (op: RouteOption) => `${km(op.total_km)}${op.distance_incomplete ? "+" : ""}`;

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
      setSpanIdx(Math.max(0, o ? o.spans.findIndex((s) => isShort(s, need ?? 0)) : 0)); // the short span, if any
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
  const short = op.spans.find((s) => isShort(s, need));
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} data-testid="route-option"
      className="block w-full rounded-md border border-l-3 border-border border-l-transparent px-3.5 py-2.5 text-left text-[13px] hover:bg-ground focus-visible:-outline-offset-3 aria-pressed:border-l-blue aria-pressed:bg-blue-bg">
      <span className="mb-0.5 flex items-start justify-between gap-2">
        <b className="text-sm font-semibold">Option {i + 1}</b>
        {op.best_match && <span className="pill h-blue">Best match</span>}
      </span>
      <span className="block text-muted-foreground">
        <b className="text-foreground">{op.total_spans}</b> {op.total_spans === 1 ? "span" : "spans"}, <b className="text-foreground">{totalKm(op)}</b> km,{" "}
        {op.estimated_db == null ? "no dB estimate" : <><b className="text-foreground">{db(op.estimated_db)}</b> estimated</>}
      </span>
      <span className="block text-muted-foreground">{op.measured_spans} of {op.total_spans} spans measured</span>
      {op.insufficient && short && (
        <span className="mt-0.5 flex items-start gap-1.5 font-semibold text-red" data-testid="route-short">
          <Icon name="fl" className="ic mt-[3px]" /><span>{shortText(short, need)}</span>
        </span>
      )}
    </button>
  );
}

// ---------- Inspector, route state ----------
export function RouteSummary({ rp, onGo }: { rp: RoutePlanner; onGo: () => void }) {
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
  const short = op.insufficient ? op.spans.find((s) => isShort(s, need)) : undefined;
  return (
    <div className="flex flex-1 flex-col" data-testid="route-summary">
      <p className="lbl">Route, option {(rp.idx ?? 0) + 1}</p>
      <h3 className="text-2xl leading-[30px] font-bold tracking-tight">{op.spans[0].site_a} to {op.spans[op.spans.length - 1].site_b}</h3>
      <p className="mt-1 text-[13px] text-muted-foreground"><b className="text-foreground">{need}</b> {need === 1 ? "core" : "cores"} needed per span</p>
      <dl className="mt-4 grid grid-cols-3 rounded-md border">
        <div className="p-3"><dt className="lbl">Spans</dt><dd className="text-2xl font-bold">{op.total_spans}</dd></div>
        <div className="border-l p-3"><dt className="lbl">Distance</dt><dd className="text-2xl font-bold">{totalKm(op)}<small className="ml-1 text-xs font-normal text-muted-foreground">km</small></dd></div>
        <div className="border-l p-3"><dt className="lbl">dB estimate</dt>
          <dd className="text-2xl font-bold">{op.estimated_db == null ? "–" : op.estimated_db.toFixed(2)}{op.estimated_db != null && <small className="ml-1 text-xs font-normal text-muted-foreground">dB</small>}</dd>
        </div>
      </dl>
      {short && (
        <p className="mt-3 flex gap-2 rounded-md border border-l-3 border-red-bd border-l-red bg-red-bg px-3 py-2.5 text-[13px] font-medium text-red">
          <Icon name="fl" className="ic mt-[3px]" /><span>{shortText(short, need)}. Pick another option or lower the cores needed.</span>
        </p>
      )}
      <div className="-mx-5 mt-auto border-t px-5 pt-5">
        <button type="button" className="btn w-full" onClick={onGo}>Go to route table and Reserve</button>
      </div>
    </div>
  );
}

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
  const type = (id: number) => spans?.find((s) => s.id === id)?.route_type ?? "–";
  const first = op.spans[0].site_a, last = op.spans[op.spans.length - 1].site_b;
  return (
    <section className="card col-span-12" aria-labelledby="route-h" data-testid="route-section">
      <div className="card-h items-center! justify-start! gap-4!">
        <h2 id="route-h" tabIndex={-1} className="outline-offset-4">
          <span className="sr-only">Route option {(rp.idx ?? 0) + 1}, {first} to {last}: </span>
          {op.total_spans} {op.total_spans === 1 ? "span" : "spans"}, {totalKm(op)} km, {op.estimated_db == null ? "No dB estimate" : `${db(op.estimated_db)} est.`}
        </h2>
        <Strip rp={rp} op={op} need={need} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6">
        <table className="tbl [&_tbody_th]:h-11 [&_td]:h-11" data-testid="route-table">
          <caption className="sr-only">Spans on this route, in travel order, with loss and free cores</caption>
          <thead><tr>
            <th scope="col" className="pl-2">#</th><th scope="col">Span</th><th scope="col">Type</th><th scope="col">From → to</th>
            <th scope="col" className="text-right!">km</th><th scope="col" className="text-right!">Est. loss (dB)</th>
            <th scope="col" className="text-right!">Measured</th><th scope="col" className="pr-2! text-right!">Free cores</th>
          </tr></thead>
          <tbody>
            {op.spans.map((s, i) => {
              const sh = isShort(s, need), l = loss?.spans[i], sel = i === rp.spanIdx;
              return (
                <tr key={s.span_id} aria-selected={sel} className={sel ? "bg-blue-bg [&>td:first-child]:shadow-[inset_3px_0_0_var(--blue)]" : ""}>
                  <td className="pl-2 text-muted-foreground">{i + 1}</td>
                  <th scope="row" className="py-1.5 text-left">
                    <button type="button" className="text-left font-semibold underline decoration-line underline-offset-4 hover:text-blue" onClick={() => rp.setSpanIdx(i)}>{s.name}</button>
                  </th>
                  <td>{type(s.span_id)}</td>
                  <td>{s.site_a} → {s.site_b}</td>
                  <td className="text-right whitespace-nowrap">{s.km == null ? "–" : km(s.km)}</td>
                  <td className="text-right whitespace-nowrap">{l?.calculated_db == null ? "–" : l.calculated_db.toFixed(2)}</td>
                  <td className="text-right whitespace-nowrap">{!l ? "–" : l.measured_db == null ? <span className="text-muted-foreground">Not measured</span> : db(l.measured_db)}</td>
                  <td className="pr-2! text-right whitespace-nowrap">
                    {sh ? <span className="inline-flex items-center gap-1 font-semibold text-red"><Icon name="fl" className="size-3" />{s.surveyed ? s.free_to_reserve : "Not surveyed"}<span className="sr-only"> short</span></span>
                      : s.free_to_reserve}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="font-bold [&_td]:border-t [&_td]:border-b-0 [&_td]:border-t-foreground [&_td]:pr-4 [&_td]:whitespace-nowrap">
            <tr>
              <td colSpan={2} className="pl-2">Total, {op.total_spans} {op.total_spans === 1 ? "span" : "spans"}</td>
              <td /><td />
              <td className="text-right">{totalKm(op)}{op.distance_incomplete && <span className="sr-only"> (some spans have no distance)</span>}</td>
              <td className="text-right">{op.estimated_db == null ? "–" : op.estimated_db.toFixed(2)}</td>
              <td className="text-right">{op.measured_spans} of {op.total_spans} measured</td>
              <td className="pr-2!" />
            </tr>
          </tfoot>
        </table>
        <ReserveBox key={ids} op={op} need={need} onDone={onDone} />
      </div>
    </section>
  );
}

// v6 drawer strip: Site — [span] — Site, one row, scrolls inside itself. One tab stop; arrow keys move between span chips.
function Strip({ rp, op, need }: { rp: RoutePlanner; op: RouteOption; need: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const n = op.spans.length;
  const kind = (name: string) => rp.eps.find((e) => e.name === name)?.kind;
  const sites = [op.spans[0].site_a, ...op.spans.map((s) => s.site_b)];
  const move = (e: KeyboardEvent) => {
    const to = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const i = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : to != null ? Math.min(n - 1, Math.max(0, rp.spanIdx + to)) : null;
    if (i == null) return;
    e.preventDefault();
    rp.setSpanIdx(i);
    ref.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus();
  };
  const text = (s: RouteSpan) => [`span ${s.name}`, s.km == null ? "no distance" : `${km(s.km)} km`,
    s.surveyed ? `${s.free_to_reserve} cores free` : "not surveyed", isShort(s, need) && `short, need ${need}`].filter(Boolean).join(", ");
  return (
    <>
      <div ref={ref} className="rs-strip" role="group" aria-label="Route strip. Arrow keys move between spans." onKeyDown={move} data-testid="route-strip">
        {sites.map((name, i) => (
          <Fragment key={i}>
            <span aria-hidden className={`sn ${i === 0 || i === n ? "end" : ""}`}>{name}</span>
            {i < n && (() => {
              const s = op.spans[i], sh = isShort(s, need), dist = s.km == null ? "no distance" : `${km(s.km)} km`;
              const label = [`Span ${s.name}`, dist, s.surveyed ? `${s.free_to_reserve} free` : "not surveyed", sh && "short"].filter(Boolean).join(", ");
              return (
                <>
                  <span aria-hidden className="ln" />
                  <button type="button" data-i={i} aria-pressed={i === rp.spanIdx} tabIndex={i === rp.spanIdx ? 0 : -1}
                    aria-label={label} title={label} className={`rs-ss ${sh ? "short" : ""}`} onClick={() => rp.setSpanIdx(i)}>
                    {sh && <Icon name="fl" className="size-3" />}{dist}
                  </button>
                  <span aria-hidden className="ln" />
                </>
              );
            })()}
          </Fragment>
        ))}
      </div>
      <ol className="sr-only" aria-label="Route as text">
        {sites.map((name, i) => (
          <li key={i}>Site {name}, {kindWord(kind(name))}{i < n && `; then ${text(op.spans[i])}`}</li>
        ))}
      </ol>
    </>
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
