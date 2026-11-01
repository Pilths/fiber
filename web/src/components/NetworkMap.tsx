import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { api } from "@/api/client";
import { health } from "@/lib/status";

// Network map card body (TASK-054, TASK-055). One overlay draws spans (SVG lines), free-cores chips and site markers
// (DOM buttons, app font, Tab reachable) in both modes:
//   "gl":  MapLibre renders the self-hosted PMTiles basemap underneath and owns the camera.
//   "svg": no basemap (WebGL unavailable, or tiles not installed): plain background, own camera, drag to pan.
// The overlay projects with Web Mercator at 512 px tiles, the same as MapLibre, so it lines up with the basemap.
// ponytail: the overlay re-renders on every camera move; fine for a few hundred spans, move lines into a MapLibre
// GeoJSON layer if real data makes panning sluggish.

export type SpanProps = {
  span_id: number; name: string; site_a_id: number; site_b_id: number; route_type: string | null; region: string | null;
  distance_km: string | null; free_to_reserve: number; surveyed: boolean; chip: "ok" | "low" | "full" | "not_surveyed"; fiber_cut?: boolean;
  segment_id: number | null; shaped?: boolean;
};
type SiteProps = { site_id: number; name: string; kind: string; lrd_site_id: number | null; region: string | null; location_from_site?: string };
type Geo<P> = { features: { properties: P; geometry: { coordinates: P extends SpanProps ? [number, number][] : [number, number] } }[]; not_drawn: { name: string; reason: string }[] };
type View = { lng: number; lat: number; zoom: number };
type Bounds = [number, number, number, number]; // west, south, east, north

const MALAYSIA: Bounds = [99.5, 0.8, 119.5, 7.5];
const TILE = 512;
const mx = (lng: number) => (lng + 180) / 360;
const my = (lat: number) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const unY = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

function fitView([w, s, e, n]: Bounds, W: number, H: number, pad = 60): View {
  const dx = Math.max(mx(e) - mx(w), 1e-4), dy = Math.max(my(s) - my(n), 1e-4);
  const zoom = Math.min(12, Math.max(4, Math.log2(Math.min((W - 2 * pad) / (dx * TILE), (H - 2 * pad) / (dy * TILE)))));
  return { lng: (w + e) / 2, lat: unY((my(s) + my(n)) / 2), zoom };
}
const boundsOf = (pts: [number, number][]): Bounds | null => pts.length ? [
  Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])),
] : null;

// Point at half the drawn length, so a chip sits on its line even when the line is shaped.
function midpoint(p: [number, number][]): [number, number] {
  const seg = p.slice(1).map((q, i) => Math.hypot(q[0] - p[i][0], q[1] - p[i][1]));
  let half = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, half / seg[i]) : 0;
      return [p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t];
    }
    half -= seg[i];
  }
  return p[0];
}

const COLOR = { ok: "var(--green)", low: "var(--amber)", full: "var(--red)", not_surveyed: "var(--ns)" } as const;
const kindOf = (t: string | null) => (t ?? "").toLowerCase();
// Chip text: the free-core number only; a cut span reads 0, not surveyed a dash.
const chipText = (p: SpanProps) => (p.fiber_cut ? "0" : p.surveyed ? String(p.free_to_reserve) : "–");

type Basemap = "loading" | "gl" | "missing" | "nogl" | "failed";
const NOTE: Partial<Record<Basemap, string>> = {
  missing: "Basemap not installed on this machine: run ./scripts/get-tiles.sh",
  failed: "Basemap tiles could not be read: run ./scripts/get-tiles.sh",
  nogl: "This browser cannot draw the basemap (no WebGL): plain map shown",
};
const webgl = () => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } };

export function NetworkMap({ selectedIds, routeKey, visible, onSelectSpan: selectSpan, onSite, onClear, version }: {
  selectedIds: number[]; routeKey: string | null; visible: (p: SpanProps) => boolean;
  onSelectSpan: (id: number) => void; onSite: (name: string) => void; onClear: () => void; version: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const glBox = useRef<HTMLDivElement>(null);
  const map = useRef<import("maplibre-gl").Map | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [gl] = useState(webgl);
  const [base, setBase] = useState<Basemap>(gl ? "loading" : "nogl");
  const [spans, setSpans] = useState<Geo<SpanProps> | null>(null);
  const [sites, setSites] = useState<Geo<SiteProps> | null>(null);
  const [err, setErr] = useState(false);
  const [layerOn, setLayerOn] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => (full ? document.exitFullscreen() : box.current!.requestFullscreen()).catch(() => {});

  useEffect(() => {
    let live = true;
    Promise.all([api.get("/api/map/spans"), api.get("/api/map/sites")])
      .then(([a, b]) => { if (live) { setSpans(a as unknown as Geo<SpanProps>); setSites(b as unknown as Geo<SiteProps>); } })
      .catch(() => live && setErr(true));
    return () => { live = false; };
  }, [version]);

  useLayoutEffect(() => {
    const el = box.current!;
    // Start on Malaysia; the data fit follows once spans arrive.
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
      setView((v) => v ?? (el.clientWidth ? fitView(MALAYSIA, el.clientWidth, el.clientHeight, 8) : null));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  // Basemap: WebGL and the PMTiles file are both needed, otherwise stay on the SVG overlay.
  const ready = view != null;
  useEffect(() => {
    if (!ready || !gl) return;
    let live = true;
    import("@/lib/basemap").then(async (bm) => {
      const has = await bm.basemapInstalled();
      if (!live) return;
      if (!has.tiles) { setBase("missing"); return; }
      const v = viewRef.current!;
      const m = bm.createBasemap(glBox.current!, [v.lng, v.lat], v.zoom, has.glyphs);
      map.current = m;
      (window as { fiberMap?: unknown }).fiberMap = m; // read by the e2e tests (layer checks); harmless otherwise
      m.on("move", () => { const c = m.getCenter(); setView({ lng: c.lng, lat: c.lat, zoom: m.getZoom() }); });
      m.on("error", (e) => { if ((e as { sourceId?: string }).sourceId === "pm" || /pmtiles/i.test(String(e.error?.message))) setBase("failed"); });
      setBase("gl");
    }).catch(() => live && setBase("nogl"));
    return () => { live = false; map.current?.remove(); map.current = null; };
  }, [ready, gl]);
  const go = useCallback((v: View) => {
    if (map.current) map.current.easeTo({ center: [v.lng, v.lat], zoom: v.zoom, duration: 250 });
    else setView(v);
  }, []);
  // A span picked on the map is already in view and stays put; a span picked anywhere else (the Find list, search) is followed.
  const clicked = useRef<number | null>(null);
  const onSelectSpan = (id: number) => { clicked.current = id; selectSpan(id); };
  const sel = new Set(selectedIds);
  const feats = spans?.features ?? [];
  const fitTo = (ids: number[] | null) => {
    if (!size.w) return;
    const pts = feats.filter((f) => !ids || ids.includes(f.properties.span_id)).flatMap((f) => f.geometry.coordinates);
    const b = boundsOf(pts);
    if (b) go(fitView(b, size.w, size.h, ids ? 100 : 70));
  };

  // First data: fit to the selection if there is one, else to all spans. A new route: fit to its spans.
  const fitted = useRef(false);
  const selKey = selectedIds.join(",");
  useEffect(() => {
    if (fitted.current || !spans || !size.w || base === "loading") return;
    fitted.current = true;
    fitTo(selectedIds.length ? selectedIds : null);
  }, [spans, size, base]); // eslint-disable-line react-hooks/exhaustive-deps -- once, when everything is in
  useEffect(() => {
    if (fitted.current && routeKey && selectedIds.length) fitTo(selectedIds);
  }, [routeKey, selKey]); // eslint-disable-line react-hooks/exhaustive-deps -- refit only when the route changes
  useEffect(() => {
    if (!fitted.current || routeKey || selectedIds.length !== 1) return;
    if (clicked.current === selectedIds[0]) { clicked.current = null; return; }
    fitTo(selectedIds);
  }, [selKey]); // eslint-disable-line react-hooks/exhaustive-deps -- follow a span selected outside the map

  // SVG mode camera: drag to pan.
  const drag = useRef<{ x: number; y: number; v: View } | null>(null);
  const onDown = (e: RPointerEvent) => {
    if (map.current || !view || (e.target as Element).closest("button,a,input,label,[data-hit],details")) return;
    drag.current = { x: e.clientX, y: e.clientY, v: view };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = TILE * 2 ** d.v.zoom;
    setView({ ...d.v, lng: d.v.lng - ((e.clientX - d.x) / k) * 360, lat: unY(my(d.v.lat) - (e.clientY - d.y) / k) });
  };

  const P = (c: [number, number]): [number, number] => {
    const v = view!, k = TILE * 2 ** v.zoom;
    return [(mx(c[0]) - mx(v.lng)) * k + size.w / 2, (my(c[1]) - my(v.lat)) * k + size.h / 2];
  };
  const ends = new Set(feats.filter((f) => sel.has(f.properties.span_id)).flatMap((f) => [f.properties.site_a_id, f.properties.site_b_id]));
  const spanCount = (id: number) => feats.filter((f) => f.properties.site_a_id === id || f.properties.site_b_id === id).length;
  const drawn = view && size.w ? feats.map((f) => {
    const p = f.properties, pts = f.geometry.coordinates.map(P);
    const on = sel.has(p.span_id), show = layerOn && (on || visible(p));
    return { p, pts, on, show, dim: show && !on && sel.size > 0, mid: midpoint(pts) };
  }) : [];
  const order = [...drawn].sort((a, b) => Number(a.on) - Number(b.on)); // selected on top

  // Declutter, greedy: site markers, then chips (selected first), then site names. A chip or name that would overlap
  // something already placed is hidden (visibility: hidden) until the user zooms in; the Find list still reaches it.
  const placed: number[][] = [[0, 0, 380, 50], [0, size.h - 170, 300, size.h]]; // controls, key
  const fits = (x: number, y: number, w: number, h: number) => {
    const r = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
    if (placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) return false;
    placed.push(r);
    return true;
  };
  const siteXY = (sites?.features ?? []).map((f) => (view && size.w ? P(f.geometry.coordinates) : [0, 0]));
  siteXY.forEach(([x, y]) => placed.push([x - 11, y - 11, x + 11, y + 11]));
  const chipShown = new Set([...drawn].filter((d) => d.show).sort((a, b) => Number(b.on) - Number(a.on)).filter(({ p, on, mid }) => {
    const w = 20 + 7.5 * chipText(p).length;
    return on ? fits(mid[0], mid[1] - 11, Math.max(w, 7.5 * p.name.length + 16), 46) : fits(mid[0], mid[1], w + 4, 24);
  }).map((d) => d.p.span_id));
  const nameShown = siteXY.map(([x, y], i) => fits(x, y + 33, 7.2 * sites!.features[i].properties.name.length + 12, 18));

  // The stage is the growing child: it fills the card when the right column makes the row taller (no blank band
  // under the map). MapLibre follows container size changes itself (ResizeObserver), the overlay via `box` above.
  return (
    <div className="flex flex-1 flex-col">
      <p id="map-instr" className="sr-only">Chips show free to reserve. Tab to a chip or site and press Enter to select; Esc clears the selection.</p>
      <div ref={box} data-testid="network-map" data-mode={base === "gl" ? "gl" : base === "loading" ? "loading" : "svg"}
        className={`relative flex-1 overflow-hidden bg-map select-none ${full ? "" : "min-h-[clamp(520px,calc(100vh-210px),860px)] rounded-md border border-border"}`}
        onKeyDown={(e) => { if (e.key === "Escape") { setLayersOpen(false); onClear(); } }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}>
        <div ref={glBox} style={{ position: "absolute", inset: 0 }} aria-hidden="true" />{/* inline: MapLibre's CSS sets position: relative */}
        {view && size.w > 0 && (
          <>
            <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true" data-testid="map-lines">
              {order.map(({ p, pts, on, show, dim }) => {
                const d = "M" + pts.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join("L");
                const t = kindOf(p.route_type), w = (t === "trunk" ? 6 : 3) + (on ? 3 : 0);
                return (
                  <g key={p.span_id} data-testid="map-line" data-span-id={p.span_id} data-selected={on} data-state={!show ? "hidden" : dim ? "dim" : ""} opacity={!show ? 0.12 : dim ? 0.35 : 1}>
                    {on && <path d={d} fill="none" stroke="#fff" strokeWidth={w + 4} strokeLinecap="round" strokeLinejoin="round" />}
                    <path d={d} fill="none" stroke={on ? "var(--blue)" : COLOR[p.chip]} strokeWidth={p.chip === "not_surveyed" && !on ? 4 : w}
                      strokeLinecap="round" strokeLinejoin="round"
                      strokeDasharray={p.chip === "not_surveyed" && !on ? "1 7" : undefined} />
                    {show && <path d={d} data-hit fill="none" stroke="transparent" strokeWidth={18} className="cursor-pointer" style={{ pointerEvents: "stroke" }} onClick={() => onSelectSpan(p.span_id)} />}
                  </g>
                );
              })}
            </svg>
            {(sites?.features ?? []).map((f, i) => {
              const s = f.properties, [x, y] = siteXY[i], dc = s.kind === "data_center", end = ends.has(s.site_id), n = spanCount(s.site_id);
              return (
                <button key={s.site_id} type="button" data-testid="map-site" data-site-id={s.site_id} data-end={end}
                  aria-label={`Site ${s.name}, ${dc ? "data centre" : "other site"}, ${n} span${n === 1 ? "" : "s"}${end ? ", end of the selection" : ""}`}
                  className={`msite ${end ? "end" : ""}`} style={{ left: x, top: y }} onClick={() => onSite(s.name)}>
                  <span className={`shape ${dc ? "dc" : "st"}`} />
                  {(nameShown[i] || end) && <span className="code" aria-hidden="true">{s.name}</span>}
                </button>
              );
            })}
            {drawn.filter((d) => d.show).map(({ p, on, mid, dim }) => {
              const h = health({ survey_cores: p.surveyed ? 1 : null, free_to_reserve: p.free_to_reserve, fiber_cut: p.fiber_cut });
              return (
                <button key={p.span_id} type="button" data-testid="map-chip" data-span-id={p.span_id} data-selected={on} aria-pressed={on}
                  aria-label={`Span ${p.name}, ${p.route_type ?? "no route type"}, ${p.surveyed ? `${p.free_to_reserve} free to reserve, ${h.word}` : "not surveyed"}`}
                  className={`mchip ${h.cls} ${on ? "on" : ""}`} style={{ left: mid[0], top: mid[1], visibility: chipShown.has(p.span_id) ? undefined : "hidden", opacity: dim ? 0.6 : undefined }} onClick={() => onSelectSpan(p.span_id)}>
                  {chipText(p)}
                  {on && <span className="mname" aria-hidden="true">{p.name}</span>}
                </button>
              );
            })}
          </>
        )}

        <div className="absolute top-3 left-3 z-10 flex items-start gap-2">
          <div className="relative">
            <button type="button" className="mbtn" aria-expanded={layersOpen} aria-controls="map-layers" onClick={() => setLayersOpen((o) => !o)}>
              <svg className="ni" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2l6 3.2-6 3.2-6-3.2zM2 8.4l6 3.2 6-3.2M2 11.4l6 3.2 6-3.2" /></svg>Layers
              <svg className="ni size-3!" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
            </button>
            <div id="map-layers" hidden={!layersOpen} className="absolute top-[38px] left-0 w-[270px] rounded-lg border border-line bg-white px-3.5 py-3">
              <fieldset>
                <legend className="lbl mb-1.5">Show on the map</legend>
                <label className="lrow"><input type="checkbox" checked={layerOn} onChange={(e) => setLayerOn(e.target.checked)} />Dark fibre</label>
                {["Services", "Data centres"].map((l) => (
                  <label key={l} className="lrow text-muted-foreground">
                    <input type="checkbox" aria-disabled="true" aria-describedby="later-t" checked={false} onChange={() => {}} onClick={(e) => e.preventDefault()} />
                    {l}<span className="later ml-auto">Later</span>
                  </label>
                ))}
              </fieldset>
              <p id="later-t" className="sr-only">Planned for a later release: services (bandwidth) and data centre details.</p>
            </div>
          </div>
          <div className="flex" role="group" aria-label="Zoom">
            <button type="button" className="mbtn w-[34px] justify-center rounded-r-none! px-0! text-base" aria-label="Zoom in" onClick={() => view && go({ ...view, zoom: Math.min(18, view.zoom + 1) })}>+</button>
            <button type="button" className="mbtn -ml-px w-[34px] justify-center rounded-l-none! px-0! text-base" aria-label="Zoom out" onClick={() => view && go({ ...view, zoom: Math.max(4, view.zoom - 1) })}>&minus;</button>
          </div>
          <button type="button" className="mbtn" onClick={() => fitTo(selectedIds.length ? selectedIds : null)}>Fit selection</button>
          {document.fullscreenEnabled && (
            <button type="button" className="mbtn" aria-pressed={full} onClick={toggleFull}>
              <svg className="ni" viewBox="0 0 16 16" aria-hidden="true">
                <path d={full ? "M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" : "M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"} />
              </svg>
              {full ? "Exit full screen" : "Full screen"}
            </button>
          )}
        </div>

        <div role="group" aria-label="Map key" className="mleg">
          <p className="mleg-h col-span-2">Route type</p>
          <span><i className="slot" aria-hidden="true"><i className="ll" /></i>Trunk</span>
          <span><i className="slot" aria-hidden="true"><i className="ll m" /></i>Metro</span>
          <span><i className="slot" aria-hidden="true"><i className="ll s" /></i>Selected</span>
          <p className="mleg-h col-span-2">Sites</p>
          <span><i className="slot" aria-hidden="true"><i className="rb-sh dc size-3!" /></i>Data centre</span>
          <span><i className="slot" aria-hidden="true"><i className="rb-sh st size-2.5!" /></i>Other site</span>
        </div>
        {(NOTE[base] || err) && (
          <p role="status" data-testid="map-note" className="absolute top-3 right-3 z-10 max-w-[340px] note px-3 py-1.5 text-xs font-medium text-amber">
            {err ? "Could not load the map data. Search and lists still work." : NOTE[base]}
          </p>
        )}
      </div>
      {spans && spans.not_drawn.length > 0 && (
        <details className="mt-2 text-xs text-muted-foreground" data-testid="map-not-drawn">
          <summary className="cursor-pointer">{spans.not_drawn.length} span{spans.not_drawn.length === 1 ? "" : "s"} not on the map (no coordinates)</summary>
          <ul className="mt-1 list-disc pl-5">
            {spans.not_drawn.map((s) => <li key={s.name}><b className="font-semibold text-foreground">{s.name}</b>: {s.reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
