import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { Blank } from "@/components/LossCard";
import type { RouteOption } from "@/components/RoutePlanner";
import { FreeBadge } from "@/components/FindCard";
import { countBy, db, LEVEL, perKm, segmentName, totalLoss, STATUS, statusLabel, type CoreStatus, type SegmentLoss } from "@/lib/status";

type Detail = components["schemas"]["SegmentDetail"];
type Core = Detail["cores"][number];
type Segment = components["schemas"]["SegmentSummary"];
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
      setMsg({ text: `${op.segments.length} ${op.segments.length === 1 ? "segment" : "segments"}, ${Number(op.total_km.toFixed(1))} km`, ok: true });
      onFound({ ids: op.segments.map((s) => s.segment_id), km: op.total_km, sites: [op.segments[0].site_a, ...op.segments.map((s) => s.site_b)] });
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

// Route (or the one selected segment) as a horizontal chain: site, segment, site ... Each segment is a button that selects it.
export function SegmentDiagram({ segments, found, d, loss, selectedId, onPick, actions, onSite }: {
  segments: Segment[] | null; found: Found | null; d: Detail; loss: SegmentLoss[]; selectedId: number; onPick: (id: number) => void;
  actions?: ReactNode; // buttons at the right end (Reserve cores, admin edits)
  onSite?: (end: "a" | "b") => void; // admins: the site names of a single segment open the site editor
}) {
  const onRoute = found?.ids.includes(d.id) ? found : null;
  const chain = onRoute
    ? onRoute.ids.map((id, i) => ({ s: segments?.find((x) => x.id === id), a: onRoute.sites[i], b: onRoute.sites[i + 1], id }))
    : [{ s: d, a: d.site_a, b: d.site_b, id: d.id }];
  const rows = chain.map((c) => ({ ...c, l: loss.find((x) => x.segment_id === c.id) }));
  const km = rows.reduce((n, r) => n + (r.s ? kmOf(r.s) ?? 0 : 0), 0);
  // Segments with a distance count: worst measured core if measured, else calculated. A segment with no distance adds neither dB nor km.
  const used = rows.flatMap((r) => { const k = r.s ? kmOf(r.s) : null, t = k ? totalLoss(r.l) : null; return t ? [{ k: k!, ...t }] : []; });
  const total = used.length ? used.reduce((n, u) => n + u.db, 0) : null;
  const usedKm = used.reduce((n, u) => n + u.k, 0);
  const anyCalc = used.some((u) => u.calc);
  const totals: [string, string][] = [
    ["Segments", String(rows.length)],
    ["Distance", km ? `${Number(km.toFixed(1))} km` : "-"],
    [anyCalc ? "Calculated loss" : "Total loss", total == null ? "-" : db(total)],
    ["Average loss per km", total != null && usedKm ? perKm(total, usedKm) : "-"],
  ];
  const cols = Math.min(rows.length, PER_ROW);
  return (
    <section className="card" aria-labelledby="segment-h" data-testid="segment-diagram">
      <h2 id="segment-h" className="sr-only">{segmentName(d)}</h2>
      {/* Site, segment, site ... in rows of up to PER_ROW segments; a row's last site starts the next row. */}
      <div className="flex items-center gap-4">
      <ol aria-label="Segments on the route" aria-description={onRoute ? `Route ${chain[0].a} to ${chain[chain.length - 1].b}` : undefined} className="grid flex-1 gap-y-4 px-16" style={{ gridTemplateColumns: `repeat(${cols}, minmax(140px, 1fr))` }}>
        {rows.map((r, i) => {
          const cut = r.s?.fiber_cut, sel = r.id === selectedId, w = r.l?.level && r.l.level !== "green" ? LEVEL[r.l.level] : null;
          const k = r.s ? kmOf(r.s) : null;
          return (
            <li key={r.id} className="relative h-[100px]">
              <button type="button" aria-pressed={sel} aria-label={`Segment ${r.a} - ${r.b}`} onClick={() => onPick(r.id)}
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
              <Site name={r.a} onEdit={!onRoute && onSite ? () => onSite("a") : undefined} />
              {(i % PER_ROW === PER_ROW - 1 || i === rows.length - 1) && <Site name={r.b} end onEdit={!onRoute && onSite ? () => onSite("b") : undefined} />}
            </li>
          );
        })}
      </ol>
      {actions && <div className="flex flex-none flex-col items-end gap-2">{actions}</div>}
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-10 gap-y-2 border-t pt-3 text-body" data-testid="route-totals">
        {totals.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
      </dl>
    </section>
  );
}

const PER_ROW = 6;
// A site on the chain: a dark node on the line and its name under it, at the segment's start (or end).
const Site = ({ name, end, onEdit }: { name: string; end?: boolean; onEdit?: () => void }) => (
  <>
    <span aria-hidden className={`pointer-events-none absolute top-[27px] size-3 rounded-full bg-foreground ring-2 ring-white ${end ? "-right-1.5" : "-left-1.5"}`} />
    {onEdit
      ? <button type="button" title={name} aria-label={`Edit site ${name}`} onClick={onEdit} className={`absolute top-[76px] max-w-[calc(100%-16px)] cursor-pointer truncate text-center text-body font-semibold underline-offset-4 hover:text-blue hover:underline ${end ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2"}`}>{name}</button>
      : <span title={name} className={`absolute top-[76px] max-w-[calc(100%-16px)] truncate text-center text-body font-semibold ${end ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2"}`}>{name}</span>}
  </>
);


type Hold = Detail["unassigned"][number];
type Row = { key: string; cores: Core[]; hold?: Hold };
const HOLD_ORDER: CoreStatus[] = ["Requested", "Reserved", "In use"];
// Holders first (Requested, Reserved, In service, then count-only), then Available. Consecutive cores of one
// reservation, and runs of Available cores, share one row.
function group(d: Detail): Row[] {
  const rows: Row[] = [];
  const by = (c: Core) => `${c.status}|${c.reservation_id ?? `${c.customer}|${c.srf_id}`}`;
  for (const st of [...HOLD_ORDER, "Available" as const]) {
    if (st === "Available") for (const h of d.unassigned) rows.push({ key: `u${h.reservation_id}`, cores: [], hold: h });
    const cs = d.cores.filter((c) => c.status === st).sort((x, y) => x.number - y.number);
    for (const c of cs) {
      const last = rows[rows.length - 1]?.cores;
      if (last?.length && last[last.length - 1].number === c.number - 1 && by(last[0]) === by(c)) last.push(c);
      else rows.push({ key: `c${c.id}`, cores: [c] });
    }
  }
  return rows;
}

type Chip = "All" | "Free" | "In use" | "Unassigned";
const inChip = (r: Row, f: Chip) => f === "All" || (f === "Unassigned" ? !!r.hold : f === "Free" ? r.cores[0]?.status === "Available" : r.hold || r.cores[0].status !== "Available");
const range = (cs: Core[]) => (cs.length === 1 ? String(cs[0].number) : `${cs[0].number}-${cs[cs.length - 1].number}`);
const portsOf = (c: Core) => (c.port_a || c.port_b ? <>{c.port_a ?? <Dash />} to {c.port_b ?? <Dash />}</> : <Blank>No ports yet</Blank>);
const Dash = () => <Blank>-</Blank>;

export function StatusWord({ s, n }: { s: CoreStatus | "Unassigned"; n?: number }) {
  if (s === "Unassigned") return <span className="inline-flex items-center gap-2 font-semibold whitespace-nowrap text-use"><Icon name="co" />Unassigned</span>;
  const st = STATUS[s];
  return (
    <span className={`inline-flex items-center gap-2 font-semibold whitespace-nowrap ${st.tone}`}>
      <span aria-hidden className={`core sw cursor-[inherit] ${st.cls}`}><Icon name={st.icon} /></span>{statusLabel(s)}{n != null && n > 1 && ` (${n})`}
    </span>
  );
}

const Stale = ({ c }: { c: Core }) => c.stale && (
  <span className="pill h-amber ml-2" title={`No keep for over 3 months since ${c.stale_since ?? "-"}`}><Icon name="lo" />Stale<span className="sr-only">: no keep for over 3 months since {c.stale_since ?? "-"}</span></span>
);

// The one Cores table: chips with counts (the only place counts appear), holders first, ranges collapse and expand.
export function CoresTable({ d, focusCoreId, onOpen, onAssign }: {
  d: Detail; focusCoreId: number | null; onOpen: (c: Core) => void; onAssign: ((h: Hold) => void) | null;
}) {
  const rows = group(d);
  const [filter, setFilter] = useState<Chip>("All");
  const [open, setOpen] = useState<Set<string>>(() => new Set(rows.filter((r) => r.cores.length > 1 && r.cores.some((c) => c.id === focusCoreId)).map((r) => r.key)));
  const n = countBy(d), un = d.unassigned.reduce((t, h) => t + h.remaining, 0);
  const count: Record<Chip, number> = { All: d.cores.length, Free: d.free_to_reserve, "In use": n.Requested + n.Reserved + n["In use"] + un, Unassigned: un };
  const toggle = (k: string) => setOpen((o) => { const x = new Set(o); if (!x.delete(k)) x.add(k); return x; });
  const cells = (c: Core, free: boolean) => (
    <>
      <td className="truncate" title={c.customer ?? undefined}>{(!free && c.customer) || <Dash />}</td>
      <td className="truncate" title={c.planner ?? undefined}>{(!free && c.planner) || <Dash />}</td>
      <td className="truncate" title={c.srf_id ?? undefined}>{(!free && c.srf_id) || <Dash />}</td>
      <td className="whitespace-nowrap">{(!free && c.planned_date) || <Dash />}</td>
      <td className="num">{!free && c.age_days != null ? `${c.age_days} d` : <Dash />}</td>
    </>
  );
  return (
    <>
      <div role="group" aria-label="Filter cores" className="mb-2 flex flex-wrap gap-2">
        {(["All", "Free", "In use", "Unassigned"] as const).map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f} <b>{count[f]}</b></button>
        ))}
      </div>
      <table className="tbl">
        <caption className="sr-only">Cores of {segmentName(d)}</caption>
        <thead><tr>
          <th scope="col" className="w-[11%]">Cores</th><th scope="col" className="w-[16%]">Status</th><th scope="col" className="w-[17%]">Customer</th>
          <th scope="col" className="w-[12%]">Planner</th><th scope="col" className="w-[10%]">SRF</th><th scope="col" className="w-[11%]">Planned</th>
          <th scope="col" className="num w-[7%]">Age</th><th scope="col">Ports</th>
        </tr></thead>
        <tbody>
          {rows.filter((r) => inChip(r, filter)).map((r) => {
            if (r.hold) {
              const h = r.hold;
              return (
                <tr key={r.key} data-testid="unassigned-row">
                  <th scope="row" className="text-left font-semibold"><span className="inline-block w-5" />{h.remaining} {h.remaining === 1 ? "core" : "cores"}</th>
                  <td><StatusWord s="Unassigned" /></td>
                  <td className="truncate" title={h.customer ?? undefined}>{h.customer ?? <Dash />}</td>
                  <td className="truncate" title={h.planner ?? undefined}>{h.planner ?? <Dash />}</td>
                  <td className="truncate" title={h.srf_id ?? undefined}>{h.srf_id ?? <Dash />}</td>
                  <td className="whitespace-nowrap">{h.planned_date ?? <Dash />}</td>
                  <td className="num">{h.age_days} d</td>
                  <td>{onAssign ? <button type="button" className="btn btn-sm" onClick={() => onAssign(h)}>Assign cores</button> : <Blank>No ports yet</Blank>}</td>
                </tr>
              );
            }
            const c = r.cores[0], free = c.status === "Available", many = r.cores.length > 1, isOpen = open.has(r.key);
            const tint = c.status === "Requested" ? "bg-amber-bg" : "";
            return (
              <Fragment key={r.key}>
                <tr onClick={() => onOpen(c)} className={`cursor-pointer hover:bg-raised ${tint} ${!many && c.id === focusCoreId ? "bg-blue-bg" : ""}`} data-core={many ? undefined : c.number}>
                  <th scope="row" className="text-left font-semibold">
                    {many ? (
                      <button type="button" className="inline-flex cursor-pointer items-center font-semibold" aria-expanded={isOpen} aria-label={`Cores ${range(r.cores)}, show each core`} onClick={(e) => { e.stopPropagation(); toggle(r.key); }}>
                        <span aria-hidden className="w-5 text-left text-muted-foreground">{isOpen ? "\u25BE" : "\u25B8"}</span>{range(r.cores)}
                      </button>
                    ) : (
                      <button type="button" className="inline-flex cursor-pointer items-center font-semibold" aria-label={`Core ${c.number} details`} onClick={(e) => { e.stopPropagation(); onOpen(c); }}>
                        <span className="w-5" />{c.number}
                      </button>
                    )}
                  </th>
                  <td><StatusWord s={c.status} n={free ? r.cores.length : undefined} />{!free && <Stale c={c} />}</td>
                  {cells(c, free)}
                  <td className="truncate">{free ? <Dash /> : many ? <Blank>{`${r.cores.filter((x) => x.port_a || x.port_b).length} of ${r.cores.length} with ports`}</Blank> : portsOf(c)}</td>
                </tr>
                {many && isOpen && r.cores.map((x) => (
                  <tr key={x.id} onClick={() => onOpen(x)} className={`cursor-pointer bg-subtle hover:bg-raised ${x.id === focusCoreId ? "bg-blue-bg!" : ""}`} data-core={x.number}>
                    <th scope="row" className="text-left">
                      <button type="button" className="inline-flex cursor-pointer items-center pl-5" aria-label={`Core ${x.number} details`} onClick={(e) => { e.stopPropagation(); onOpen(x); }}>{x.number}</button>
                    </th>
                    <td><StatusWord s={x.status} />{!free && <Stale c={x} />}</td>
                    {cells(x, free)}
                    <td className="truncate">{free ? <Dash /> : portsOf(x)}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// One row per count-only reservation: cores requested but not yet assigned to specific cores.
export const Unassigned = ({ d }: { d: Detail }) => d.unassigned.length > 0 && (
  <dl className="mt-3 text-body" data-testid="unassigned">
    {d.unassigned.map((u) => (
      <div key={u.reservation_id} className="flex gap-3 py-0.5">
        <dt className="w-28 flex-none text-muted-foreground">Unassigned</dt>
        <dd className="font-semibold">{[`${u.remaining} ${u.remaining === 1 ? "core" : "cores"}`, u.customer, u.srf_id, u.planner].filter(Boolean).join(", ")}</dd>
      </div>
    ))}
  </dl>
);
