import type { components } from "@/api/schema";
import { health, type SegmentFilter } from "@/lib/status";

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

// Region and Type in the map toolbar: they dim the other segments on the map.
export function MapFilters({ segments, filter, onFilter }: { segments: Segment[] | null; filter: SegmentFilter; onFilter: (f: SegmentFilter) => void }) {
  const all = segments ?? [];
  const cls = "field h-8 w-auto text-[13px] font-semibold";
  return (
    <>
      <select className={cls} aria-label="Region" value={filter.region} onChange={(e) => onFilter({ ...filter, region: e.target.value })}>
        <option value="">All regions</option>
        {options(all, "region").map((o) => <option key={o}>{o}</option>)}
      </select>
      <select className={cls} aria-label="Type" value={filter.routeType} onChange={(e) => onFilter({ ...filter, routeType: e.target.value })}>
        <option value="">All types</option>
        {options(all, "route_type").map((o) => <option key={o}>{o}</option>)}
      </select>
    </>
  );
}
