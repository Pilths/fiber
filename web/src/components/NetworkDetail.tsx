import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { FreeBadge } from "@/components/FindCard";
import { segmentName } from "@/lib/status";

type Detail = components["schemas"]["SegmentDetail"];
type Segment = components["schemas"]["SegmentSummary"];
export type Found = { ids: number[]; km: number; sites: string[] }; // sites in travel order, one more than ids

// Narrowest segment: fits "999.9 km" and the free badge, and keeps 16px between neighbouring site names
// (longer names truncate, full name on hover).
const MIN_W = 112;

const SITE_NAME_CLASS = "absolute top-[76px] max-w-[calc(100%-16px)] truncate text-center text-body font-semibold";
const SITE_BUTTON_CLASS = `${SITE_NAME_CLASS} cursor-pointer underline-offset-4 hover:text-blue hover:underline`;
const SITE_NODE_CLASS =
  "pointer-events-none absolute top-[27px] size-3 rounded-full bg-foreground ring-2 ring-white";
const LEG_BUTTON_CLASS =
  "relative -mx-2.5 flex w-[calc(100%+20px)] cursor-pointer flex-col items-center gap-1 rounded-md " +
  "border border-transparent py-1.5 select-none hover:bg-raised aria-pressed:border-blue aria-pressed:bg-blue-bg";

const kmOf = (segment: { distance_km: string | null }) => {
  if (!segment.distance_km) {
    return null;
  }
  return Number(segment.distance_km);
};

type DiagramRow = { segment: Segment | Detail | undefined; a: string; b: string; id: number };

function diagramRows(segments: Segment[] | null, onRoute: Found | null, detail: Detail): DiagramRow[] {
  if (!onRoute) {
    return [{ segment: detail, a: detail.site_a, b: detail.site_b, id: detail.id }];
  }
  return onRoute.ids.map((id, i) => ({
    segment: segments?.find((each) => each.id === id),
    a: onRoute.sites[i],
    b: onRoute.sites[i + 1],
    id,
  }));
}

function rowKm(row: DiagramRow): number | null {
  if (!row.segment) {
    return null;
  }
  return kmOf(row.segment);
}

function distanceText(km: number): string {
  if (!km) {
    return "-";
  }
  return `${Number(km.toFixed(1))} km`;
}

// Route (or the one selected segment) as a horizontal chain: site, segment, site ...
// Each segment is a button that selects it.
export function SegmentDiagram({ segments, found, detail, selectedId, onPick, onSite }: {
  segments: Segment[] | null;
  found: Found | null;
  detail: Detail;
  selectedId: number;
  onPick: (id: number) => void;
  onSite?: (end: "a" | "b") => void; // admins: the site names of a single segment open the site editor
}) {
  const onRoute = found?.ids.includes(detail.id) ? found : null;
  const rows = diagramRows(segments, onRoute, detail);
  const km = rows.reduce((total, row) => total + (rowKm(row) ?? 0), 0);
  const totals: [string, string][] = [
    ["Segments", String(rows.length)],
    ["Distance", distanceText(km)],
  ];
  const legs = rows.map((row) => ({
    id: row.id,
    a: row.a,
    b: row.b,
    km: rowKm(row),
    cut: row.segment?.fiber_cut,
    segment: row.segment,
  }));
  const route = onRoute ? `Route ${rows[0].a} to ${rows[rows.length - 1].b}` : undefined;
  const siteEditor = !onRoute && onSite ? onSite : undefined;
  return (
    <section className="card" aria-labelledby="segment-h" data-testid="segment-diagram">
      <h2 id="segment-h" className="sr-only">{segmentName(detail)}</h2>
      <Chain legs={legs} selectedId={selectedId} onPick={onPick} route={route} onSite={siteEditor} />
      <div className="mt-2 flex items-center gap-4 border-t pt-3">
        <dl className="flex flex-1 flex-wrap gap-x-10 gap-y-2 text-body" data-testid="route-totals">
          {totals.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <KmzLink segment={detail} />
      </div>
    </section>
  );
}

// The selected segment's line as drawn on the map, as a KMZ for Google Earth.
// A plain link: the login cookie goes with it.
function KmzLink({ segment }: { segment: Detail }) {
  const name = segmentName(segment);
  return (
    <a className="btn" href={`/api/map/segments/${segment.id}/kmz`} download={`${name}.kmz`}
      aria-label={`Download KMZ of segment ${name}`}>
      Download KMZ
    </a>
  );
}

export type Leg = {
  id: number;
  a: string;
  b: string;
  km: number | null;
  cut?: boolean;
  segment?: Segment | Detail;
};

type ChainProps = {
  legs: Leg[];
  selectedId: number | null;
  onPick: (id: number) => void;
  onUnpick?: (id: number) => void;
  badge?: (id: number) => ReactNode;
  describe?: (id: number) => string; // describe: the badge in words (the button's name hides it)
  route?: string;
  onSite?: (end: "a" | "b") => void;
};

// Scrolls only the line, never the page, so the selected segment is in view.
function useSelectedInView(selectedId: number | null, legCount: number) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const line = list.current;
    const item = line?.querySelector("[aria-pressed=true]")?.closest("li");
    if (!line || !item) {
      return;
    }
    const left = item.offsetLeft - line.scrollLeft;
    const right = left + item.offsetWidth;
    if (left < 0 || right > line.clientWidth) {
      line.scrollLeft += left - (line.clientWidth - item.offsetWidth) / 2;
    }
  }, [selectedId, legCount]);
  return list;
}

// The chain itself: site, segment, site ... on one line. Segments shrink to MIN_W to fit, then the line scrolls
// sideways and keeps the selected segment in view.
// Each segment is a button. With onUnpick, double-click (or Enter/Space) on the selected segment unselects it.
// badge replaces the free badge under the line (a cut segment always shows Cut).
export function Chain({ legs, selectedId, onPick, onUnpick, badge, describe, route, onSite }: ChainProps) {
  const fresh = useRef<number | null>(null); // the segment the first click of a double-click selected: not unselected
  const list = useSelectedInView(selectedId, legs.length);
  const columns = `repeat(${legs.length}, minmax(${MIN_W}px, 1fr))`;
  const clickLeg = (id: number, selected: boolean, event: MouseEvent) => {
    // keyboard: Enter/Space toggles off
    if (event.detail === 0 && selected && onUnpick) {
      onUnpick(id);
      return;
    }
    if (event.detail <= 1) {
      fresh.current = selected ? null : id;
    }
    onPick(id);
  };
  let doubleClickLeg: ((id: number) => void) | undefined;
  if (onUnpick) {
    doubleClickLeg = (id) => {
      if (fresh.current !== id) {
        onUnpick(id);
      }
    };
  }
  return (
    <ol ref={list} aria-label="Segments on the route" aria-description={route}
      className="relative grid overflow-x-auto px-16 pb-2" style={{ gridTemplateColumns: columns }}>
      {legs.map((leg, i) => (
        <ChainLeg key={leg.id} leg={leg} last={i === legs.length - 1} selected={leg.id === selectedId}
          onClick={clickLeg} onDoubleClick={doubleClickLeg} badge={badge} describe={describe} onSite={onSite} />
      ))}
    </ol>
  );
}

type ChainLegProps = Pick<ChainProps, "badge" | "describe" | "onSite"> & {
  leg: Leg;
  last: boolean;
  selected: boolean;
  onClick: (id: number, selected: boolean, event: MouseEvent) => void;
  onDoubleClick?: (id: number) => void;
};

function LegBadge({ leg, badge }: { leg: Leg; badge?: (id: number) => ReactNode }) {
  if (leg.cut) {
    return <span className="pill h-red"><Icon name="fl" />Cut</span>;
  }
  if (badge) {
    return badge(leg.id);
  }
  if (!leg.segment) {
    return null;
  }
  return <FreeBadge s={leg.segment} />;
}

function ChainLeg({ leg, last, selected, onClick, onDoubleClick, badge, describe, onSite }: ChainLegProps) {
  const lineStyle = leg.cut ? "border-dashed border-red" : "border-blue";
  return (
    <li className="relative h-[100px]">
      <button type="button" aria-pressed={selected} aria-label={`Segment ${leg.a} - ${leg.b}`}
        aria-description={describe?.(leg.id)} onClick={(event) => onClick(leg.id, selected, event)}
        onDoubleClick={onDoubleClick && (() => onDoubleClick(leg.id))}
        className={LEG_BUTTON_CLASS}>
        <span className="h-5 text-body leading-5 font-semibold">{leg.km == null ? "-" : `${leg.km} km`}</span>
        <span aria-hidden className="h-1" />
        <span className="flex h-[22px] items-center gap-1.5">
          <LegBadge leg={leg} badge={badge} />
        </span>
      </button>
      {/* The line runs node to node, over the button's tint; clicks pass through to the button. */}
      <span aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-[31px] border-t-4 ${lineStyle}`} />
      <Site name={leg.a} onEdit={onSite ? () => onSite("a") : undefined} />
      {last && <Site name={leg.b} end onEdit={onSite ? () => onSite("b") : undefined} />}
    </li>
  );
}

// A site on the chain: a dark node on the line and its name under it, at the segment's start (or end).
function Site({ name, end, onEdit }: { name: string; end?: boolean; onEdit?: () => void }) {
  const nodeSide = end ? "-right-1.5" : "-left-1.5";
  const nameSide = end ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2";
  return (
    <>
      <span aria-hidden className={`${SITE_NODE_CLASS} ${nodeSide}`} />
      {onEdit ? (
        <button type="button" title={name} aria-label={`Edit site ${name}`} onClick={onEdit}
          className={`${SITE_BUTTON_CLASS} ${nameSide}`}>
          {name}
        </button>
      ) : (
        <span title={name} className={`${SITE_NAME_CLASS} ${nameSide}`}>{name}</span>
      )}
    </>
  );
}
