import { useMemo, useState } from "react";
import type { components } from "@/api/schema";
import { inputCls, STATUS, STATUS_ORDER } from "@/lib/status";

type Span = components["schemas"]["SpanSummary"];

export function SpanList({ spans, selectedId, onSelect }: { spans: Span[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const [region, setRegion] = useState("");
  const [routeType, setRouteType] = useState("");
  const opts = (k: "region" | "route_type") => [...new Set(spans.map((s) => s[k]).filter((v): v is string => !!v))].sort();
  const shown = useMemo(
    () => spans.filter((s) => (!region || s.region === region) && (!routeType || s.route_type === routeType)),
    [spans, region, routeType],
  );
  return (
    <section aria-labelledby="spans-h">
      <h2 id="spans-h" className="mb-2 text-lg font-semibold">Spans ({shown.length})</h2>
      <div className="mb-3 flex flex-wrap gap-3">
        <label className="text-sm">Region{" "}
          <select className={inputCls} value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All</option>
            {opts("region").map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        <label className="text-sm">Route type{" "}
          <select className={inputCls} value={routeType} onChange={(e) => setRouteType(e.target.value)}>
            <option value="">All</option>
            {opts("route_type").map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
      </div>
      {/* No fixed-height box: every span is in the page flow (PRD rule). */}
      <ul className="space-y-2">
        {shown.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              aria-pressed={s.id === selectedId}
              onClick={() => onSelect(s.id)}
              className={`w-full rounded-lg border p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${s.id === selectedId ? "border-2 border-foreground bg-accent" : "bg-card hover:bg-muted"}`}
            >
              <span className="block font-medium">{s.site_a} - {s.site_b}</span>
              <span className="block text-sm text-muted-foreground">
                {[s.region, s.route_type, s.distance_km && `${Number(s.distance_km)} km`].filter(Boolean).join(" / ")}
              </span>
              <span className="mt-1 block text-sm">
                {s.survey_cores == null
                  ? <strong>Not surveyed</strong>
                  : <><strong>{s.free_to_reserve} free to reserve</strong> of {s.survey_cores} surveyed</>}
                {s.unassigned_reserved > 0 && ` (+${s.unassigned_reserved} reserved, not assigned)`}
              </span>
              <span className="block text-xs text-muted-foreground">
                {STATUS_ORDER.filter((k) => s.status_mix[k]).map((k) => `${STATUS[k].symbol} ${k} ${s.status_mix[k]}`).join("  ")}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="text-sm">No spans match the filters.</li>}
      </ul>
    </section>
  );
}
