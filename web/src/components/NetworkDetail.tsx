import { Fragment, useEffect, useState, type FormEvent } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { Blank, LossPill, Metric } from "@/components/LossCard";
import type { RouteOption } from "@/components/RoutePlanner";
import { FreeBadge } from "@/components/FindCard";
import { countBy, db, LEVEL, pct, spanName, STATUS, STATUS_ORDER, statusLabel, type CoreStatus, type LossDetail, type SpanLoss } from "@/lib/status";

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


// Total loss of a span: its worst measured core (dB); not measured -> the calculated loss (distance x 0.3 dB/km), flagged.
type Loss = Pick<SpanLoss, "measured_db" | "calculated_db">;
const totalLoss = (l: Loss | null | undefined) =>
  l?.measured_db != null ? { db: l.measured_db, calc: false } : l?.calculated_db != null ? { db: l.calculated_db, calc: true } : null;
const lossText = (t: { db: number; calc: boolean } | null) => (t ? `${db(t.db)}${t.calc ? " calculated" : ""}` : "No distance");
const perKm = (dB: number, km: number) => `${(dB / km).toFixed(2)} dB/km`;
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
  const allMeasured = rows.every((r) => r.l?.measured_db != null);
  // A span with no distance has no calculated loss: it adds neither dB nor km, and the line says how many were left out.
  const vals = rows.map((r) => (allMeasured ? r.l!.measured_db : r.l?.calculated_db) ?? null);
  const missing = vals.filter((v) => v == null).length;
  const total = missing === rows.length ? null : vals.reduce<number>((n, v) => n + (v ?? 0), 0);
  return (
    <section className="card" aria-labelledby="diagram-h" data-testid="span-diagram">
      <h2 id="diagram-h" className="sr-only">{onRoute ? `Route ${chain[0].a} to ${chain[chain.length - 1].b}` : spanName(d)}</h2>
      <ol aria-label="Spans on the route" className="flex flex-wrap items-center gap-y-4">
        {rows.map((r, i) => {
          const cut = r.s?.fiber_cut, sel = r.id === selectedId, w = r.l?.level && r.l.level !== "green" ? LEVEL[r.l.level] : null;
          const k = r.s ? kmOf(r.s) : null;
          return (
            <Fragment key={r.id}>
              {i === 0 && <li className="font-semibold">{r.a}</li>}
              <li>
                <button type="button" aria-pressed={sel} onClick={() => onPick(r.id)}
                  className="mx-2 flex min-w-36 flex-col items-stretch gap-1.5 rounded-md border border-transparent px-2 py-1.5 hover:bg-raised aria-pressed:border-blue aria-pressed:bg-blue-bg">
                  <span className="sr-only">{r.a} - {r.b},</span>
                  <span aria-hidden className={`block border-t-4 ${cut ? "border-dashed border-red" : "border-blue"}`} />
                  <span className="flex items-center justify-center gap-2 text-body">
                    <span className="font-semibold">{k == null ? "No distance" : `${k} km`}</span>
                    {cut ? <span className="pill h-red"><Icon name="fl" />Cut</span> : r.s && <FreeBadge s={r.s} />}
                    {w && <span className={`inline-flex items-center ${w.cls.replace("h-", "v-")}`} title={`Loss ${w.word}`} data-testid="loss-marker"><Icon name={w.icon} /><span className="sr-only">Loss {w.word}</span></span>}
                  </span>
                </button>
              </li>
              <li className="font-semibold">{r.b}</li>
            </Fragment>
          );
        })}
      </ol>
      <p className="mt-4 border-t pt-3 text-body" data-testid="route-totals">
        {rows.length} {rows.length === 1 ? "span" : "spans"}, {Number(km.toFixed(1))} km, total loss {total == null ? "unknown" : `${db(total)}${allMeasured ? "" : " calculated"}`}
        {total != null && km > 0 && `, average ${perKm(total, km)}`}
        {total != null && missing > 0 && `, ${missing} ${missing === 1 ? "span" : "spans"} without distance not counted`}
      </p>
    </section>
  );
}

export function SpanCard({ d, loss }: { d: Detail; loss: LossDetail | null }) {
  const cut = d.fiber_cut;
  const typeRoute = [d.route_type, d.route].filter(Boolean).join(", ");
  const t = totalLoss(loss), km = kmOf(d);
  const worst = !loss || loss.measured_db == null ? "Not measured"
    : [loss.worst_core_number != null ? `core ${loss.worst_core_number}` : "core not recorded", loss.deviation_pct != null && pct(loss.deviation_pct)].filter(Boolean).join(", ");
  return (
    <section className="card" aria-labelledby="span-h" data-testid="span-card">
      <h2 id="span-h" className="mb-4 text-2xl leading-8 font-bold tracking-tight">{spanName(d)}</h2>
      <dl className="grid grid-cols-7 gap-4 [&_dd>span]:text-xl [&_dd>span]:leading-7">
        <Metric label="Type and route" value={typeRoute || "-"} />
        <Metric label="Distance" value={km ? `${km} km` : "No distance"} />
        <Metric label="Free cores">
          <span className={`block font-bold tracking-tight ${cut ? "text-red" : ""}`}>
            {cut ? "Cut" : d.survey_cores == null ? "Not surveyed" : `${d.free_to_reserve} of ${d.survey_cores}`}
          </span>
        </Metric>
        <Metric label="Total loss" value={loss ? lossText(t) : "-"} />
        <Metric label="Average loss per km" value={!loss ? "-" : !km ? "No distance" : t ? perKm(t.db, km) : "-"} />
        <Metric label="Worst core" value={worst} />
        <Metric label="Cores measured" value={loss ? `${loss.measured_cores} of ${loss.total_cores}` : "-"} />
      </dl>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="lbl">{label}</dt><dd className="mt-0.5 font-semibold break-words">{children}</dd></div>;
}

const ports = (c: Core) => c.status === "Available" ? <Blank>None</Blank>
  : c.port_a || c.port_b ? <>{c.port_a ?? <Blank />} to {c.port_b ?? <Blank />}</> : <Blank>No ports yet</Blank>;

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
                      <button type="button" className="link" aria-expanded={open} aria-label={`Core ${c.number} details`} onClick={(e) => { e.stopPropagation(); toggle(c.id); }}>{c.number}</button>
                    </th>
                    <td><span className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap ${st.tone}`}><Icon name={st.icon} />{statusLabel(c.status)}</span>
                      {c.stale && <>{" "}<span className="pill h-amber" title={`No keep for over 3 months since ${c.stale_since ?? "-"}`}><Icon name="lo" />Stale<span className="sr-only">: no keep for over 3 months since {c.stale_since ?? "-"}</span></span></>}</td>
                    <td className="truncate">{free ? <Blank>None</Blank> : c.customer ?? <Blank />}</td>
                    <td className="whitespace-nowrap">{free ? <Blank>None</Blank> : c.planned_date ?? <Blank />}</td>
                    <td className="truncate">{ports(c)}</td>
                    <td className="pr-0 whitespace-nowrap">{cl ? <span className="inline-flex items-center gap-2">{db(cl.measured_db)}<LossPill l={cl} compact /></span> : "-"}</td>
                  </tr>
                  {open && (
                    <tr data-testid="core-detail">
                      <td colSpan={6} className="h-auto! bg-subtle px-4! py-3!">
                        <div className="flex items-start justify-between gap-4">
                          <dl className="text-body"><Field label="Circuit ID">{free ? <Blank>None</Blank> : c.circuit_id ? <span className="font-mono">{c.circuit_id}</span> : <Blank />}</Field></dl>
                          <button type="button" className="btn btn-sm" onClick={() => onActions(c)}>History and actions</button>
                        </div>
                        {!loss ? <p className="mt-2 text-body text-muted-foreground">Loading loss...</p> : !cl ? (
                          <p role="status" className="mt-2 note px-3 py-2 text-body" data-testid="core-no-loss">
                            No loss test yet. {calc != null ? `Calculated loss for the span is ${db(calc)}.` : "No distance, so no calculated loss."}
                          </p>
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

// One line per count-only reservation: cores requested but not yet assigned to specific cores.
export const Unassigned = ({ d }: { d: Detail }) => d.unassigned.length > 0 && (
  <ul className="mt-3 space-y-1 text-body" data-testid="unassigned">
    {d.unassigned.map((u) => (
      <li key={u.reservation_id} className="flex items-center gap-2">
        <Icon name="co" className="ic text-use" />
        <span><b className="font-semibold">{u.remaining} {u.remaining === 1 ? "core" : "cores"}</b> requested, not assigned yet{u.customer ? `, ${u.customer}` : ""}</span>
      </li>
    ))}
  </ul>
);
