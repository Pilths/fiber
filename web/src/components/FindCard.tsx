import { useState } from "react";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { health, spanName } from "@/lib/status";

type Span = components["schemas"]["SpanSummary"];

export function FreeBadge({ s }: { s: Span }) {
  const h = health(s);
  return (
    <span className={`pill min-w-11 justify-center gap-[5px] ${h.cls}`}>
      <Icon name={h.icon} className="size-2.5" />{h.value}<span className="sr-only">{s.survey_cores == null ? "" : ` free to reserve, ${h.word}`}</span>
    </span>
  );
}

// Find card: "Span or site" lists every span (filters narrow it); "Route A to B" lands in the routes session (TASK-051).
export function FindCard({ spans, selectedId, onSelect }: { spans: Span[] | null; selectedId: number | null; onSelect: (id: number) => void }) {
  const [mode, setMode] = useState<"span" | "route">("span");
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [routeType, setRouteType] = useState("");
  const all = spans ?? [];
  const opts = (k: "region" | "route_type") => [...new Set(all.map((s) => s[k]).filter((v): v is string => !!v))].sort();
  const t = q.trim().toLowerCase();
  const shown = all.filter((s) => (!region || s.region === region) && (!routeType || s.route_type === routeType) && (!t || spanName(s).toLowerCase().includes(t)));

  return (
    <section className="card" aria-labelledby="find-h">
      <div className="card-h"><h2 id="find-h">Find</h2><small className="hint">Search works without the map</small></div>
      <div role="radiogroup" aria-label="Find mode" className="grid h-9 grid-cols-2 overflow-hidden rounded-md border border-line">
        {([["span", "Span or site"], ["route", "Route A to B"]] as const).map(([m, label], i) => (
          <label key={m} className={`relative flex cursor-pointer items-center justify-center px-3 font-medium whitespace-nowrap has-checked:bg-foreground has-checked:font-semibold has-checked:text-white has-focus-visible:z-10 has-focus-visible:outline-3 has-focus-visible:outline-blue ${i ? "border-l border-line" : ""}`}>
            <input type="radio" name="find-mode" className="absolute size-px opacity-0" checked={mode === m} onChange={() => setMode(m)} />{label}
          </label>
        ))}
      </div>

      {mode === "route" ? (
        <p className="mt-3 rounded-md border border-dashed border-line px-4 py-5 text-center text-[13px] text-muted-foreground">
          <b className="block text-sm font-semibold text-foreground">Coming in the routes session</b>
          From, To and route options arrive with route planning.
        </p>
      ) : (
        <>
          <div className="relative mt-3">
            <svg viewBox="0 0 16 16" aria-hidden="true" className="ni pointer-events-none absolute left-3 top-2.5 text-muted-foreground"><path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5" /></svg>
            <input type="search" aria-label="Span or site name" placeholder="Span or site name" className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="lbl mt-3 flex justify-between px-2.5"><span>Span</span><span>Free to reserve</span></div>
          {!spans && <p className="py-3 text-[13px] text-muted-foreground">Loading spans...</p>}
          <ul aria-label="Spans" className="max-h-[242px] overflow-auto">
            {shown.map((s) => (
              <li key={s.id}>
                <button type="button" aria-pressed={s.id === selectedId} onClick={() => onSelect(s.id)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 border-b border-l-3 border-b-rule border-l-transparent py-1 pl-2.5 pr-1 text-left hover:bg-ground focus-visible:-outline-offset-3 aria-pressed:border-l-blue aria-pressed:bg-blue-bg">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{spanName(s)}</span>
                    <span className="block text-xs text-muted-foreground">{[s.region, s.route_type, s.distance_km && `${Number(s.distance_km)} km`].filter(Boolean).join(", ")}</span>
                  </span>
                  <FreeBadge s={s} />
                </button>
              </li>
            ))}
            {spans && shown.length === 0 && <li className="py-3 text-[13px] text-muted-foreground">No spans match.</li>}
          </ul>
        </>
      )}

      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3.5">
        <label className="grid gap-1"><span className="lbl">Region</span>
          <select className="field" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All regions</option>
            {opts("region").map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        <label className="grid gap-1"><span className="lbl">Route type</span>
          <select className="field" value={routeType} onChange={(e) => setRouteType(e.target.value)}>
            <option value="">All types</option>
            {opts("route_type").map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        <p className="col-span-2 text-xs text-muted-foreground" aria-live="polite"><b className="text-foreground">{shown.length} of {all.length}</b> spans shown</p>
      </div>
    </section>
  );
}
