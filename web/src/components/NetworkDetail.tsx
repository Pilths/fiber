import { Fragment, useEffect, useState, type FormEvent } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { Blank, LossNum } from "@/components/LossCard";
import type { RouteOption } from "@/components/RoutePlanner";
import { FreeBadge } from "@/components/FindCard";
import { countBy, db, LEVEL, pct, perKm, spanName, totalLoss, STATUS, STATUS_ORDER, statusLabel, type CoreStatus, type LossDetail, type SpanLoss } from "@/lib/status";

type Detail = components["schemas"]["SpanDetail"];
type Core = Detail["cores"][number];
type Span = components["schemas"]["SpanSummary"];
type Endpoint = { id: number; name: string };
export type Found = { ids: number[]; km: number; sites: string[] }; // sites in travel order, one more than ids

// Route A to B over the whole network: the best (first) option of GET /api/routes, shown on the map and in the Inspector.
export function RouteSearch({ onFound }: { onFound: (f: Found | null) => void }) {
  const [eps, setEps] = useState<Endpoint[]>([]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => { api.get("/api/routes/endpoints").then((r) => setEps(r as unknown as Endpoint[])).catch(() => setMsg({ text: "Could not load the site list.", ok: false })); }, []);

  const search = async (x = a, y = b) => {
    const site = (t: string) => eps.find((e) => e.name.toLowerCase() === t.trim().toLowerCase());
    const from = site(x), to = site(y);
    const fail = (text: string) => { setMsg({ text, ok: false }); onFound(null); };
    if (!from || !to) return fail("Choose sites from the list");
    if (from.id === to.id) return fail("Choose two different sites");
    try {
      const r = (await api.get("/api/routes", { query: { from: from.id, to: to.id, cores_needed: 1, sort: "km" } })) as unknown as { options: RouteOption[] };
      const op = r.options[0];
      if (!op) return fail("No route found");
      setMsg({ text: `${op.spans.length} ${op.spans.length === 1 ? "span" : "spans"}, ${Number(op.total_km.toFixed(1))} km`, ok: true });
      onFound({ ids: op.spans.map((s) => s.span_id), km: op.total_km, sites: [op.spans[0].site_a, ...op.spans.map((s) => s.site_b)] });
    } catch { fail("Could not load the route. Try again."); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); search(); };
  const swap = () => { setA(b); setB(a); if (a && b) search(b, a); };

  return (
    <section className="card col-span-12 px-4 py-3" aria-label="Route search">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="w-56"><span className="lbl">Route A</span><input id="route-a" className="field" list="route-sites" value={a} onChange={(e) => setA(e.target.value)} autoComplete="off" /></label>
        <button type="button" className="btn px-3" onClick={swap} aria-label="Swap A and B">&#8646;</button>
        <label className="w-56"><span className="lbl">Route B</span><input className="field" list="route-sites" value={b} onChange={(e) => setB(e.target.value)} autoComplete="off" /></label>
        <button type="submit" className="btn btn-p" disabled={!eps.length}>Search</button>
        {msg && <span role="status" data-testid="route-found" className={`self-center font-semibold ${msg.ok ? "text-foreground" : "text-red"}`}>{msg.text}</span>}
        <datalist id="route-sites">{eps.map((e) => <option key={e.id} value={e.name} />)}</datalist>
      </form>
    </section>
  );
}


const kmOf = (s: { distance_km: string | null }) => (s.distance_km ? Number(s.distance_km) : null);

// Route (or the one selected span) as a horizontal chain: site, span, site ... Each span is a button that selects it.
export function SpanDiagram({ spans, found, d, loss, selectedId, onPick }: {
  spans: Span[] | null; found: Found | null; d: Detail; loss: SpanLoss[]; selectedId: number; onPick: (id: number) => void;
}) {
  const onRoute = found?.ids.includes(d.id) ? found : null;
  const chain = onRoute
    ? onRoute.ids.map((id, i) => ({ s: spans?.find((x) => x.id === id), a: onRoute.sites[i], b: onRoute.sites[i + 1], id }))
    : [{ s: d, a: d.site_a, b: d.site_b, id: d.id }];
  const rows = chain.map((c) => ({ ...c, l: loss.find((x) => x.span_id === c.id) }));
  const km = rows.reduce((n, r) => n + (r.s ? kmOf(r.s) ?? 0 : 0), 0);
  // Spans with a distance count: worst measured core if measured, else calculated. A span with no distance adds neither dB nor km.
  const used = rows.flatMap((r) => { const k = r.s ? kmOf(r.s) : null, t = k ? totalLoss(r.l) : null; return t ? [{ k: k!, ...t }] : []; });
  const total = used.length ? used.reduce((n, u) => n + u.db, 0) : null;
  const usedKm = used.reduce((n, u) => n + u.k, 0);
  const anyCalc = used.some((u) => u.calc);
  const totals: [string, string][] = [
    ["Spans", String(rows.length)],
    ["Distance", km ? `${Number(km.toFixed(1))} km` : "-"],
    [anyCalc ? "Calculated loss" : "Total loss", total == null ? "-" : db(total)],
    ["Average loss per km", total != null && usedKm ? perKm(total, usedKm) : "-"],
  ];
  const cols = Math.min(rows.length, PER_ROW);
  return (
    <section className="card" aria-labelledby="diagram-h" data-testid="span-diagram">
      <h2 id="diagram-h" className="sr-only">{onRoute ? `Route ${chain[0].a} to ${chain[chain.length - 1].b}` : spanName(d)}</h2>
      {/* Site, span, site ... in rows of up to PER_ROW spans; a row's last site starts the next row. */}
      <ol aria-label="Spans on the route" className="grid gap-y-4 px-16" style={{ gridTemplateColumns: `repeat(${cols}, minmax(140px, 1fr))` }}>
        {rows.map((r, i) => {
          const cut = r.s?.fiber_cut, sel = r.id === selectedId, w = r.l?.level && r.l.level !== "green" ? LEVEL[r.l.level] : null;
          const k = r.s ? kmOf(r.s) : null;
          return (
            <li key={r.id} className="relative h-[100px]">
              <button type="button" aria-pressed={sel} aria-label={`Span ${r.a} - ${r.b}`} onClick={() => onPick(r.id)}
                className="mx-3 flex w-[calc(100%-24px)] cursor-pointer flex-col items-center gap-1 rounded-md border border-transparent py-1.5 hover:bg-raised aria-pressed:border-blue aria-pressed:bg-blue-bg">
                <span className="h-5 text-body leading-5 font-semibold">{k == null ? "-" : `${k} km`}</span>
                <span aria-hidden className="h-1" />
                <span className="flex h-[22px] items-center gap-1.5">
                  {cut ? <span className="pill h-red"><Icon name="fl" />Cut</span> : r.s && <FreeBadge s={r.s} />}
                  {w && <span className={`inline-flex items-center ${w.cls.replace("h-", "v-")}`} title={`Loss ${w.word}`} data-testid="loss-marker"><Icon name={w.icon} /><span className="sr-only">Loss {w.word}</span></span>}
                </span>
              </button>
              {/* The line runs node to node, over the button's tint; clicks pass through to the button. */}
              <span aria-hidden className={`pointer-events-none absolute inset-x-0 top-[31px] border-t-4 ${cut ? "border-dashed border-red" : "border-blue"}`} />
              <Site name={r.a} />
              {(i % PER_ROW === PER_ROW - 1 || i === rows.length - 1) && <Site name={r.b} end />}
            </li>
          );
        })}
      </ol>
      <dl className="mt-2 flex flex-wrap gap-x-10 gap-y-2 border-t pt-3 text-body" data-testid="route-totals">
        {totals.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
      </dl>
    </section>
  );
}

const PER_ROW = 6;
// A site on the chain: a dark node on the line and its name under it, at the segment's start (or end).
const Site = ({ name, end }: { name: string; end?: boolean }) => (
  <>
    <span aria-hidden className={`pointer-events-none absolute top-[27px] size-3 rounded-full bg-foreground ring-2 ring-white ${end ? "-right-1.5" : "-left-1.5"}`} />
    <span title={name} className={`absolute top-[76px] max-w-[calc(100%-16px)] truncate text-center text-body font-semibold ${end ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2"}`}>{name}</span>
  </>
);


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="lbl">{label}</dt><dd className="mt-0.5 font-semibold break-words">{children}</dd></div>;
}

const Dash = () => <Blank>-</Blank>;
const ports = (c: Core) => c.status === "Available" ? <Dash />
  : c.port_a || c.port_b ? <>{c.port_a ?? <Dash />} to {c.port_b ?? <Dash />}</> : <Blank>No ports yet</Blank>;

// View-only table of the span's cores; a row opens its detail (circuit, loss tests) right under it.
export function CoresTable({ d, loss, focusCoreId, onActions }: { d: Detail; loss: LossDetail | null; focusCoreId: number | null; onActions: (c: Core) => void }) {
  const [filter, setFilter] = useState<CoreStatus | "All">("All");
  const [openId, setOpenId] = useState<number | null>(focusCoreId);
  const n = countBy(d);
  const rows = d.cores.filter((c) => filter === "All" || c.status === filter);
  const calc = loss?.calculated_db ?? null;
  const toggle = (id: number) => setOpenId((o) => (o === id ? null : id));
  return (
    <>
      <div role="group" aria-label="Filter cores by status" className="mb-2 flex flex-wrap gap-2">
        {(["All", ...STATUS_ORDER] as const).filter((f) => f === "All" || n[f] > 0).map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f !== "All" && <Icon name={STATUS[f].icon} className={`ic ${filter === f ? "" : STATUS[f].tone}`} />}{statusLabel(f)} <b>{f === "All" ? d.cores.length : n[f]}</b>
          </button>
        ))}
      </div>
      <div className="max-h-[480px] overflow-auto" data-testid="cores-box">
        <table className="tbl table-fixed [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-1 [&_thead_th]:bg-white">
          <caption className="sr-only">Cores of {spanName(d)}</caption>
          <thead><tr>
            <th scope="col" className="w-[9%]">Core</th><th scope="col" className="w-[19%]">Status</th><th scope="col" className="w-[22%]">Customer</th>
            <th scope="col" className="w-[13%]">Planned date</th><th scope="col">Ports</th><th scope="col" className="w-[13%] pr-0!">Loss</th>
          </tr></thead>
          <tbody>
            {rows.map((c) => {
              const st = STATUS[c.status], free = c.status === "Available", cl = loss?.cores.find((x) => x.core_id === c.id), open = openId === c.id;
              return (
                <Fragment key={c.id}>
                  <tr onClick={() => toggle(c.id)} className={`cursor-pointer hover:bg-raised ${open ? "bg-blue-bg" : ""}`} data-core={c.number}>
                    <th scope="row" className="text-left font-semibold">
                      <button type="button" className="inline-flex cursor-pointer items-center gap-1.5 font-semibold" aria-expanded={open} aria-label={`Core ${c.number} details`} onClick={(e) => { e.stopPropagation(); toggle(c.id); }}>
                        <span aria-hidden className="w-3 text-muted-foreground">{open ? "\u25BE" : "\u25B8"}</span>{c.number}
                      </button>
                    </th>
                    <td><span className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap ${st.tone}`}><Icon name={st.icon} />{statusLabel(c.status)}</span>
                      {c.stale && <>{" "}<span className="pill h-amber" title={`No keep for over 3 months since ${c.stale_since ?? "-"}`}><Icon name="lo" />Stale<span className="sr-only">: no keep for over 3 months since {c.stale_since ?? "-"}</span></span></>}</td>
                    <td className="truncate">{(!free && c.customer) || <Dash />}</td>
                    <td className="whitespace-nowrap">{(!free && c.planned_date) || <Dash />}</td>
                    <td className="truncate">{ports(c)}</td>
                    <td className="pr-0 whitespace-nowrap">{cl ? <LossNum l={cl}>{db(cl.measured_db)}</LossNum> : <Dash />}</td>
                  </tr>
                  {open && (
                    <tr data-testid="core-detail">
                      <td colSpan={6} className="h-auto! bg-subtle px-4! py-3!">
                        <div className="flex items-start justify-between gap-4">
                          <dl className="text-body"><Field label="Circuit ID">{!free && c.circuit_id ? <span className="font-mono">{c.circuit_id}</span> : <Dash />}</Field></dl>
                          <button type="button" className="btn btn-sm" onClick={() => onActions(c)}>History and actions</button>
                        </div>
                        {!loss ? <p className="mt-2 text-body text-muted-foreground">Loading loss...</p> : !cl ? (
                          <p className="mt-2 text-body text-muted-foreground" data-testid="core-no-loss">No loss test</p>
                        ) : (
                          <table className="tbl mt-2 table-fixed" data-testid="core-tests">
                            <caption className="sr-only">Loss tests of core {c.number}, newest first</caption>
                            <thead><tr>
                              <th scope="col" className="w-[18%] static!">Tested</th><th scope="col" className="w-[18%] static!">Measured</th><th scope="col" className="w-[18%] static!">Difference</th>
                              <th scope="col" className="static!">Method</th><th scope="col" className="static! pr-0!">Verified by</th>
                            </tr></thead>
                            <tbody>
                              {cl.history.map((h, i) => (
                                <tr key={i}>
                                  <th scope="row" className="text-left font-semibold">{h.tested_on ?? <Blank />}</th>
                                  <td>{db(h.loss_db)}</td>
                                  <td>{calc ? pct(((h.loss_db - calc) / calc) * 100) : <Blank>Not applicable</Blank>}</td>
                                  <td className="truncate">{h.test_method ?? <Blank />}</td>
                                  <td className="truncate pr-0">{h.field_team ?? <Blank />}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Unassigned d={d} />
    </>
  );
}

// One row per count-only reservation: cores requested but not yet assigned to specific cores.
export const Unassigned = ({ d }: { d: Detail }) => d.unassigned.length > 0 && (
  <dl className="mt-3 text-body" data-testid="unassigned">
    {d.unassigned.map((u) => (
      <div key={u.reservation_id} className="flex gap-3 py-0.5">
        <dt className="w-28 flex-none text-muted-foreground">Unassigned</dt>
        <dd className="font-semibold">{u.remaining} {u.remaining === 1 ? "core" : "cores"}{u.customer ? `, ${u.customer}` : ""}</dd>
      </div>
    ))}
  </dl>
);
