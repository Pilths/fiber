import { useEffect, useRef, useState, type ReactNode } from "react";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { Blank } from "@/components/LossCard";
import { FreeBadge } from "@/components/FindCard";
import { segmentName, STATUS, statusLabel, type CoreStatus } from "@/lib/status";

type Detail = components["schemas"]["SegmentDetail"];
type Core = Detail["cores"][number];
type Segment = components["schemas"]["SegmentSummary"];
export type Found = { ids: number[]; km: number; sites: string[] }; // sites in travel order, one more than ids

const kmOf = (s: { distance_km: string | null }) => (s.distance_km ? Number(s.distance_km) : null);

// Route (or the one selected segment) as a horizontal chain: site, segment, site ... Each segment is a button that selects it.
export function SegmentDiagram({ segments, found, d, selectedId, onPick, onSite }: {
  segments: Segment[] | null; found: Found | null; d: Detail; selectedId: number; onPick: (id: number) => void;
  onSite?: (end: "a" | "b") => void; // admins: the site names of a single segment open the site editor
}) {
  const onRoute = found?.ids.includes(d.id) ? found : null;
  const rows = onRoute
    ? onRoute.ids.map((id, i) => ({ s: segments?.find((x) => x.id === id), a: onRoute.sites[i], b: onRoute.sites[i + 1], id }))
    : [{ s: d, a: d.site_a, b: d.site_b, id: d.id }];
  const km = rows.reduce((n, r) => n + (r.s ? kmOf(r.s) ?? 0 : 0), 0);
  const totals: [string, string][] = [
    ["Segments", String(rows.length)],
    ["Distance", km ? `${Number(km.toFixed(1))} km` : "-"],
  ];
  return (
    <section className="card" aria-labelledby="segment-h" data-testid="segment-diagram">
      <h2 id="segment-h" className="sr-only">{segmentName(d)}</h2>
      <Chain legs={rows.map((r) => ({ id: r.id, a: r.a, b: r.b, km: r.s ? kmOf(r.s) : null, cut: r.s?.fiber_cut, s: r.s }))}
        selectedId={selectedId} onPick={onPick} route={onRoute ? `Route ${rows[0].a} to ${rows[rows.length - 1].b}` : undefined}
        onSite={!onRoute && onSite ? onSite : undefined} />
      <dl className="mt-2 flex flex-wrap gap-x-10 gap-y-2 border-t pt-3 text-body" data-testid="route-totals">
        {totals.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
      </dl>
    </section>
  );
}

export type Leg = { id: number; a: string; b: string; km: number | null; cut?: boolean; s?: Segment | Detail };

// The chain itself: site, segment, site ... on one line. Segments shrink to MIN_W to fit, then the line scrolls sideways
// and keeps the selected segment in view.
// Each segment is a button. With onUnpick, double-click (or Enter/Space) on the selected segment unselects it.
// badge replaces the free badge under the line (a cut segment always shows Cut).
export function Chain({ legs, selectedId, onPick, onUnpick, badge, describe, route, onSite }: {
  legs: Leg[]; selectedId: number | null; onPick: (id: number) => void; onUnpick?: (id: number) => void;
  badge?: (id: number) => ReactNode; describe?: (id: number) => string; // describe: the badge in words (the button's name hides it)
  route?: string; onSite?: (end: "a" | "b") => void;
}) {
  const fresh = useRef<number | null>(null); // the segment the first click of a double-click selected: not unselected
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { // scroll only the line, never the page
    const ol = list.current, b = ol?.querySelector("[aria-pressed=true]")?.closest("li");
    if (!ol || !b) return;
    const l = b.offsetLeft - ol.scrollLeft, r = l + b.offsetWidth;
    if (l < 0 || r > ol.clientWidth) ol.scrollLeft += l - (ol.clientWidth - b.offsetWidth) / 2;
  }, [selectedId, legs.length]);
  return (
    <ol ref={list} aria-label="Segments on the route" aria-description={route} className="relative grid overflow-x-auto px-16 pb-2" style={{ gridTemplateColumns: `repeat(${legs.length}, minmax(${MIN_W}px, 1fr))` }}>
      {legs.map((r, i) => {
        const sel = r.id === selectedId;
        return (
          <li key={r.id} className="relative h-[100px]">
            <button type="button" aria-pressed={sel} aria-label={`Segment ${r.a} - ${r.b}`} aria-description={describe?.(r.id)}
              onClick={(e) => {
                if (e.detail === 0 && sel && onUnpick) return onUnpick(r.id); // keyboard: Enter/Space toggles off
                if (e.detail <= 1) fresh.current = sel ? null : r.id;
                onPick(r.id);
              }}
              onDoubleClick={onUnpick && (() => fresh.current !== r.id && onUnpick(r.id))}
              className="relative -mx-2.5 flex w-[calc(100%+20px)] cursor-pointer flex-col items-center gap-1 rounded-md border border-transparent py-1.5 select-none hover:bg-raised aria-pressed:border-blue aria-pressed:bg-blue-bg">
              <span className="h-5 text-body leading-5 font-semibold">{r.km == null ? "-" : `${r.km} km`}</span>
              <span aria-hidden className="h-1" />
              <span className="flex h-[22px] items-center gap-1.5">
                {r.cut ? <span className="pill h-red"><Icon name="fl" />Cut</span> : badge ? badge(r.id) : r.s && <FreeBadge s={r.s} />}
              </span>
            </button>
            {/* The line runs node to node, over the button's tint; clicks pass through to the button. */}
            <span aria-hidden className={`pointer-events-none absolute inset-x-0 top-[31px] border-t-4 ${r.cut ? "border-dashed border-red" : "border-blue"}`} />
            <Site name={r.a} onEdit={onSite ? () => onSite("a") : undefined} />
            {i === legs.length - 1 && <Site name={r.b} end onEdit={onSite ? () => onSite("b") : undefined} />}
          </li>
        );
      })}
    </ol>
  );
}

// Narrowest segment: fits "999.9 km" and the free badge, and keeps 16px between neighbouring site names (longer names truncate, full name on hover).
const MIN_W = 112;
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
type GroupKey = CoreStatus | "Unassigned";
type Group = { s: GroupKey; n: number; rows: Row[] };
const ORDER: GroupKey[] = ["Requested", "Reserved", "In use", "Unassigned", "Available"];
// One group per status, holders first, Available last; empty groups are left out. One row per core.
function group(d: Detail): Group[] {
  return ORDER.map((st): Group => {
    if (st === "Unassigned") return { s: st, n: d.unassigned.reduce((t, h) => t + h.remaining, 0), rows: d.unassigned.map((h) => ({ key: `u${h.reservation_id}`, cores: [], hold: h })) };
    const cs = d.cores.filter((c) => c.status === st).sort((x, y) => x.number - y.number);
    return { s: st, n: cs.length, rows: cs.map((c) => ({ key: `c${c.id}`, cores: [c] })) };
  }).filter((g) => g.rows.length);
}
const has = (g: Group, f: (c: Core) => boolean) => g.rows.some((r) => r.cores.some(f));

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

// The one Cores table: a group per status with its count in the group header (the only place counts appear);
// Available starts collapsed. One row per core.
export function CoresTable({ d, focusCoreId, flash, onOpen, onAssign }: {
  d: Detail; focusCoreId: number | null; onOpen: (c: Core) => void; onAssign: ((h: Hold) => void) | null;
  flash?: number | null; // reservation id just requested: its row is highlighted briefly
}) {
  const groups = group(d);
  const [closed, setClosed] = useState<Set<GroupKey>>(() => new Set(groups.some((g) => g.s === "Available" && !has(g, (c) => c.id === focusCoreId)) ? ["Available"] : []));
  // A new flash (request just sent) opens the group that holds it.
  const [seenFlash, setSeenFlash] = useState(flash);
  if (flash !== seenFlash) {
    setSeenFlash(flash);
    const g = flash != null && groups.find((x) => has(x, (c) => c.reservation_id === flash));
    if (g && closed.has(g.s)) setClosed((o) => { const x = new Set(o); x.delete(g.s); return x; });
  }
  const toggleGroup = (k: GroupKey) => setClosed((o) => { const x = new Set(o); if (!x.delete(k)) x.add(k); return x; });
  // Available rows leave the middle columns empty: those columns never hold anything for a free core.
  const cells = (c: Core, free: boolean) => free ? <td colSpan={5} /> : (
    <>
      <td className="truncate" title={c.customer ?? undefined}>{c.customer || <Dash />}</td>
      <td className="truncate" title={c.planner ?? undefined}>{c.planner || <Dash />}</td>
      <td className="truncate" title={c.srf_id ?? undefined}>{c.srf_id || <Dash />}</td>
      <td className="whitespace-nowrap">{c.planned_date || <Dash />}</td>
      <td className="num">{c.age_days != null ? `${c.age_days} d` : <Dash />}<Stale c={c} /></td>
    </>
  );
  return (
    <table className="tbl">
      <caption className="sr-only">Cores of {segmentName(d)}</caption>
      {/* Shared widths so the columns line up down every group. */}
      <colgroup><col className="w-[11%]" /><col className="w-[18%]" /><col className="w-[13%]" /><col className="w-[11%]" /><col className="w-[11%]" /><col className="w-[14%]" /><col /></colgroup>
      {groups.map((g) => {
        const shut = closed.has(g.s);
        return (
          <tbody key={g.s} data-testid="core-group" data-status={g.s}>
            <tr>
              <th colSpan={7} scope="rowgroup" className="grp">
                <button type="button" className="inline-flex cursor-pointer items-center gap-2" aria-expanded={!shut} onClick={() => toggleGroup(g.s)}>
                  <span aria-hidden className="w-4 text-lg leading-none text-muted-foreground">{shut ? "\u25B8" : "\u25BE"}</span>
                  <StatusWord s={g.s} />
                  <span className="font-semibold tabular-nums">{g.s === "Unassigned" ? `${g.n} ${g.n === 1 ? "core" : "cores"}` : g.n}</span>
                </button>
              </th>
            </tr>
            {!shut && (g.s === "Available"
              ? <tr className="colhead"><th scope="col">Cores</th><td colSpan={5} /><th scope="col">Ports</th></tr>
              : <tr className="colhead">{["Cores", "Customer", "Planner", "SRF", "Planned", "Age", "Ports"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>)}
            {!shut && g.rows.map((r) => {
              if (r.hold) {
                const h = r.hold;
                return (
                  <tr key={r.key} data-testid="unassigned-row">
                    <th scope="row" className="font-semibold">{h.remaining} {h.remaining === 1 ? "core" : "cores"}</th>
                    <td className="truncate" title={h.customer ?? undefined}>{h.customer ?? <Dash />}</td>
                    <td className="truncate" title={h.planner ?? undefined}>{h.planner ?? <Dash />}</td>
                    <td className="truncate" title={h.srf_id ?? undefined}>{h.srf_id ?? <Dash />}</td>
                    <td className="whitespace-nowrap">{h.planned_date ?? <Dash />}</td>
                    <td className="num">{h.age_days} d</td>
                    <td>{onAssign ? <button type="button" className="btn btn-sm" onClick={() => onAssign(h)}>Assign cores</button> : <Blank>No ports yet</Blank>}</td>
                  </tr>
                );
              }
              const c = r.cores[0], free = c.status === "Available";
              return (
                <tr key={r.key} onClick={() => onOpen(c)} className={`cursor-pointer hover:bg-raised ${c.status === "Requested" ? "bg-amber-bg" : ""} ${c.id === focusCoreId ? "bg-blue-bg" : ""} ${flash != null && c.reservation_id === flash ? "flash" : ""}`}
                  data-core={c.number} data-flash={(flash != null && c.reservation_id === flash) || undefined}>
                  <th scope="row" className="font-semibold">
                    <button type="button" className="cursor-pointer font-semibold" aria-label={`Core ${c.number} details`} onClick={(e) => { e.stopPropagation(); onOpen(c); }}>{c.number}</button>
                  </th>
                  {cells(c, free)}
                  <td className="truncate">{portsOf(c)}</td>
                </tr>
              );
            })}
          </tbody>
        );
      })}
    </table>
  );
}
