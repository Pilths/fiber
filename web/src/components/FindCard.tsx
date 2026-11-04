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

// Route types worked out by the backend from the two end sites (Trunk is listed per route above them).
const LINK_TYPES = ["Metro", "DC-DC", "DC-TOC"];

// Trunk routes (R1, R3, ...) found on trunk segments, in name order.
function trunkRoutes(all: Segment[]): string[] {
  const routes = new Set<string>();
  for (const segment of all) {
    if (segment.route_type === "Trunk" && segment.route) {
      routes.add(segment.route);
    }
  }
  return [...routes].sort();
}

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
      <select className={cls} aria-label="Type" value={filter.network} onChange={(e) => onFilter({ ...filter, network: e.target.value })}>
        <option value="">All types</option>
        {trunkRoutes(all).map((route) => <option key={route} value={`trunk:${route}`}>Trunk {route}</option>)}
        {LINK_TYPES.map((type) => <option key={type} value={`type:${type}`}>{type}</option>)}
        <option value="dc">DC</option>
        <option value="toc">TOC</option>
      </select>
    </>
  );
}
