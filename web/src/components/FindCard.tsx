import type { components } from "@/api/schema";
import { health, inFilter, segmentName, type SegmentFilter } from "@/lib/status";

type Segment = components["schemas"]["SegmentSummary"];

export function FreeBadge({ s }: { s: Parameters<typeof health>[0] }) {
  const h = health(s);
  return (
    <span className={`pill min-w-11 justify-center ${h.cls}`}>
      {h.value}<span className="sr-only">{s.survey_cores == null ? "" : ` free to reserve, ${h.word}`}</span>
    </span>
  );
}

const options = (all: Segment[], k: "region" | "route_type") => [...new Set(all.map((s) => s[k]).filter((v): v is string => !!v))].sort();

// Inventory segment list (beside the map, same height): search, Region and Type, rows of name, km and free count.
export function SegmentList({ segments, selectedId, onSelect, filter, onFilter }: {
  segments: Segment[] | null; selectedId: number | null; onSelect: (id: number) => void;
  filter: SegmentFilter; onFilter: (f: SegmentFilter) => void;
}) {
  const all = segments ?? [];
  const t = filter.q.trim().toLowerCase();
  const shown = all.filter((s) => inFilter(s, filter) && (!t || segmentName(s).toLowerCase().includes(t)));
  return (
    <section className="card absolute inset-0 flex flex-col p-0" aria-label="Segment list">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="ni pointer-events-none absolute left-3 top-2.5 text-muted-foreground"><path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5" /></svg>
          <input id="find-q" type="search" aria-label="Search segment" placeholder="Search segment" className="field pl-9" value={filter.q} onChange={(e) => onFilter({ ...filter, q: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select className="field" aria-label="Region" value={filter.region} onChange={(e) => onFilter({ ...filter, region: e.target.value })}>
            <option value="">All regions</option>
            {options(all, "region").map((o) => <option key={o}>{o}</option>)}
          </select>
          <select className="field" aria-label="Type" value={filter.routeType} onChange={(e) => onFilter({ ...filter, routeType: e.target.value })}>
            <option value="">All types</option>
            {options(all, "route_type").map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>
      {!segments && <p className="p-3 text-body text-muted-foreground">Loading segments...</p>}
      <ul aria-label="Segments" className="min-h-0 flex-1 overflow-auto">
        {shown.map((s) => (
          <li key={s.id}>
            <button type="button" aria-pressed={s.id === selectedId} onClick={() => onSelect(s.id)}
              className="flex min-h-12 w-full items-center justify-between gap-2 border-b border-l-3 border-b-rule border-l-transparent py-1 pr-3 pl-2.5 text-left hover:bg-ground focus-visible:-outline-offset-3 aria-pressed:border-l-blue aria-pressed:bg-blue-bg">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{segmentName(s)}</span>
                <span className="block text-xs text-muted-foreground">{s.distance_km ? `${Number(s.distance_km)} km` : "-"}</span>
              </span>
              <FreeBadge s={s} />
            </button>
          </li>
        ))}
        {segments && shown.length === 0 && <li className="p-3 text-body text-muted-foreground">No segments match.</li>}
      </ul>
    </section>
  );
}
