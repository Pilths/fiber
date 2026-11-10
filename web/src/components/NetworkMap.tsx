import type { ReactNode } from "react";
import { health } from "@/lib/status";
import { makePlacer, midpoint, project, type Point } from "@/lib/mapGeometry";
import {
  chipText,
  KEY_LABEL,
  LINE_COLOR,
  LINE_WIDTH,
  lineKind,
  ROUTE_LAYERS,
  routeLayerOn,
  SITE_LAYERS,
  siteLayerOn,
  siteLook,
  trunkRoutesOf,
  type SegmentProps,
} from "@/lib/mapLayers";
import { useNetworkMap, type Basemap, type NetworkMapState } from "@/lib/useNetworkMap";

// Network map card body (TASK-054, TASK-055). One overlay draws segments (SVG lines), free-cores chips
// and site markers (DOM buttons, app font, Tab reachable) in both modes:
//   "gl":  MapLibre renders the self-hosted PMTiles basemap underneath and owns the camera.
//   "svg": no basemap (WebGL unavailable, or tiles not installed): plain background, own camera, drag to pan.
// ponytail: the overlay re-renders on every camera move; fine for a few hundred segments, move lines into a
// MapLibre GeoJSON layer if real data makes panning sluggish.

const NOTE: Partial<Record<Basemap, string>> = {
  missing: "Basemap not installed on this machine: run ./scripts/get-tiles.sh",
  failed: "Basemap tiles could not be read: run ./scripts/get-tiles.sh",
  nogl: "This browser cannot draw the basemap (no WebGL): plain map shown",
};
const LAYERS_PANEL_CLASS =
  "absolute top-[38px] left-0 w-[270px] rounded-lg border border-line bg-white px-3.5 py-3";
const NOTE_CLASS =
  "absolute top-3 right-3 z-10 max-w-[340px] note px-3 py-1.5 text-xs font-medium text-amber";
const FRAMED_CLASS = "min-h-[clamp(520px,calc(100vh-210px),860px)] rounded-md border border-border";
const SITE_HALF = 11; // half the marker box, in px
// Areas kept free of chips and names: the controls (top left) and the key (bottom left).
function reservedAreas(height: number): number[][] {
  return [[0, 0, 380, 50], [0, height - 200, 300, height]];
}

type DrawnLine = {
  segment: SegmentProps;
  points: Point[];
  selected: boolean;
  show: boolean;
  dim: boolean;
  mid: Point;
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Lines to draw, in screen coordinates. Hidden layers drop out unless the line is selected.
function drawnLines(state: NetworkMapState, visible: (segment: SegmentProps) => boolean): DrawnLine[] {
  const { camera, size, selected } = state;
  if (!camera || !size.w) {
    return [];
  }
  const layered = state.features.filter((feature) => {
    const isSelected = selected.has(feature.properties.segment_id);
    return isSelected || routeLayerOn(state.routeLayers, state.trunkOff, feature.properties);
  });
  return layered.map((feature) => {
    const segment = feature.properties;
    const points = feature.geometry.coordinates.map((coordinate) => project(camera, size, coordinate));
    const isSelected = selected.has(segment.segment_id);
    const show = isSelected || visible(segment);
    const dim = show && !isSelected && selected.size > 0;
    return { segment, points, selected: isSelected, show, dim, mid: midpoint(points) };
  });
}

// Declutter, greedy: site markers, then chips (selected first), then site names. A chip or name that would
// overlap something already placed is hidden (visibility: hidden) until the user zooms in.
function declutter(state: NetworkMapState, lines: DrawnLine[], sitePoints: Point[]) {
  const placer = makePlacer(reservedAreas(state.size.h));
  for (const [x, y] of sitePoints) {
    placer.block([x - SITE_HALF, y - SITE_HALF, x + SITE_HALF, y + SITE_HALF]);
  }
  const chipShown = new Set<number>();
  const shown = lines.filter((line) => line.show);
  const byPriority = shown.sort((a, b) => Number(b.selected) - Number(a.selected));
  for (const { segment, selected, mid } of byPriority) {
    const chipWidth = 20 + 7.5 * chipText(segment).length;
    let fits: boolean;
    if (selected) {
      const labelWidth = Math.max(chipWidth, 7.5 * segment.name.length + 16);
      fits = placer.fits(mid[0], mid[1] - 11, labelWidth, 46);
    } else {
      fits = placer.fits(mid[0], mid[1], chipWidth + 4, 24);
    }
    if (fits) {
      chipShown.add(segment.segment_id);
    }
  }
  const sites = state.data.sites?.features ?? [];
  const nameShown = sitePoints.map(([x, y], i) => {
    const nameWidth = 7.2 * sites[i].properties.name.length + 12;
    return placer.fits(x, y + 33, nameWidth, 18);
  });
  return { chipShown, nameShown };
}

function linePath(points: Point[]): string {
  return "M" + points.map((point) => `${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join("L");
}

function lineState(line: DrawnLine): string {
  if (!line.show) {
    return "hidden";
  }
  return line.dim ? "dim" : "";
}

function lineOpacity(line: DrawnLine): number {
  if (!line.show) {
    return 0.12;
  }
  return line.dim ? 0.5 : 1;
}

function MapLine({ line, onSelect }: { line: DrawnLine; onSelect: (id: number) => void }) {
  const { segment, selected } = line;
  const path = linePath(line.points);
  const kind = lineKind(segment.route_type);
  const width = (LINE_WIDTH[kind] ?? 4) + (selected ? 3 : 0);
  const dotted = segment.chip === "not_surveyed" && !selected;
  let dash: string | undefined;
  if (dotted) {
    dash = "1 7";
  } else if (kind === "dc-toc") {
    dash = "9 5";
  }
  const colour = selected ? "var(--blue)" : LINE_COLOR[kind] ?? "var(--line-metro)";
  return (
    <g data-testid="map-line" data-segment-id={segment.segment_id} data-selected={selected}
      data-state={lineState(line)} opacity={lineOpacity(line)}>
      {/* white casing on every line: keeps the dash and double-line patterns readable over the basemap */}
      <path d={path} fill="none" stroke="#fff" strokeWidth={width + (selected ? 4 : 3)}
        strokeLinecap="round" strokeLinejoin="round" />
      <path d={path} fill="none" stroke={colour} strokeWidth={dotted ? 4 : width}
        strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
      {/* DC-DC: a double line, the colour with a thin white centre */}
      {kind === "dc-dc" && !dotted && (
        <path d={path} fill="none" stroke="#fff" strokeWidth={selected ? 3 : 2.5}
          strokeLinecap="round" strokeLinejoin="round" />
      )}
      {line.show && (
        <path d={path} data-hit fill="none" stroke="transparent" strokeWidth={18} className="cursor-pointer"
          style={{ pointerEvents: "stroke" }} onClick={() => onSelect(segment.segment_id)} />
      )}
    </g>
  );
}

function MapLines({ lines, onSelect }: { lines: DrawnLine[]; onSelect: (id: number) => void }) {
  const selectedOnTop = [...lines].sort((a, b) => Number(a.selected) - Number(b.selected));
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true"
      data-testid="map-lines">
      {selectedOnTop.map((line) => (
        <MapLine key={line.segment.segment_id} line={line} onSelect={onSelect} />
      ))}
    </svg>
  );
}

function SiteMarkers({ state, sitePoints, nameShown, onSite }: {
  state: NetworkMapState;
  sitePoints: Point[];
  nameShown: boolean[];
  onSite: (name: string) => void;
}) {
  const features = state.features;
  const ends = new Set(
    features
      .filter((feature) => state.selected.has(feature.properties.segment_id))
      .flatMap((feature) => [feature.properties.site_a_id, feature.properties.site_b_id]),
  );
  const touches = (feature: (typeof features)[number], siteId: number) =>
    feature.properties.site_a_id === siteId || feature.properties.site_b_id === siteId;
  const segmentCount = (siteId: number) => features.filter((feature) => touches(feature, siteId)).length;
  return (state.data.sites?.features ?? []).map((feature, i) => {
    const site = feature.properties;
    const [x, y] = sitePoints[i];
    const isEnd = ends.has(site.site_id);
    if (!isEnd && !siteLayerOn(state.siteLayers, site.kind)) {
      return null;
    }
    const look = siteLook(site.kind);
    const endNote = isEnd ? ", end of the selection" : "";
    const segmentsText = plural(segmentCount(site.site_id), "segment");
    const label = `Site ${site.name}, ${look.word}, ${segmentsText}${endNote}`;
    return (
      <button key={site.site_id} type="button" data-testid="map-site" data-site-id={site.site_id}
        data-end={isEnd}
        aria-label={label} className={`msite ${isEnd ? "end" : ""}`} style={{ left: x, top: y }}
        onClick={() => onSite(site.name)}>
        <span className={`shape ${look.shape}`} />
        {(nameShown[i] || isEnd) && <span className="code" aria-hidden="true">{site.name}</span>}
      </button>
    );
  });
}

type SegmentChipProps = { line: DrawnLine; shown: boolean; onSelect: (id: number) => void };

function SegmentChip({ line, shown, onSelect }: SegmentChipProps) {
  const { segment, selected, mid } = line;
  const status = health({
    survey_cores: segment.surveyed ? 1 : null,
    free_to_reserve: segment.free_to_reserve,
    fiber_cut: segment.fiber_cut,
  });
  let freeText = "not verified";
  if (segment.surveyed) {
    freeText = `${segment.free_to_reserve} free to reserve, ${status.word}`;
  }
  const label = `Segment ${segment.name}, ${segment.route_type ?? "no route type"}, ${freeText}`;
  const style = {
    left: mid[0],
    top: mid[1],
    visibility: shown ? undefined : ("hidden" as const),
    opacity: line.dim ? 0.6 : undefined,
  };
  return (
    <button type="button" data-testid="map-chip" data-segment-id={segment.segment_id} data-selected={selected}
      aria-pressed={selected} aria-label={label} className={`mchip ${status.cls} ${selected ? "on" : ""}`}
      style={style} onClick={() => onSelect(segment.segment_id)}>
      {chipText(segment)}
      {selected && <span className="mname" aria-hidden="true">{segment.name}</span>}
    </button>
  );
}

// The Layers panel: Routes (type tick boxes with their key swatch, trunk route chips) and Sites.
function LayersPanel({ state }: { state: NetworkMapState }) {
  const { routeLayers, trunkOff, siteLayers } = state;
  const trunkRoutes = trunkRoutesOf(state.features);
  const toggleTrunk = (route: string) => {
    const next = new Set(trunkOff);
    if (next.has(route)) {
      next.delete(route);
    } else {
      next.add(route);
    }
    state.setTrunkOff(next);
  };
  return (
    <div id="map-layers" hidden={!state.layersOpen} className={LAYERS_PANEL_CLASS}>
      <fieldset>
        <legend className="lbl mb-1.5">Routes</legend>
        {ROUTE_LAYERS.map(([type, swatch]) => (
          <div key={type} className="flex items-center gap-2">
            <label className="lrow flex-1">
              <input type="checkbox" checked={routeLayers[type]}
                onChange={(event) => {
                  state.setRouteLayers({ ...routeLayers, [type]: event.target.checked });
                }} />
              <i className="slot" aria-hidden="true"><i className={swatch} /></i>
              {type}
            </label>
            {type === "Trunk" && trunkRoutes.map((route) => (
              <button key={route} type="button" className="chip h-6! px-2! text-xs"
                aria-pressed={!trunkOff.has(route)} aria-label={`Trunk ${route}`}
                disabled={!routeLayers.Trunk}
                onClick={() => toggleTrunk(route)}>
                {route}
              </button>
            ))}
          </div>
        ))}
      </fieldset>
      <fieldset className="mt-2.5">
        <legend className="lbl mb-1.5">Sites</legend>
        {SITE_LAYERS.map(([kind, label, shape]) => (
          <label key={kind} className="lrow">
            <input type="checkbox" checked={siteLayers[kind]}
              onChange={(event) => state.setSiteLayers({ ...siteLayers, [kind]: event.target.checked })} />
            <i className="slot" aria-hidden="true"><i className={shape} /></i>
            {label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

function MapControls({ state, tools }: { state: NetworkMapState; tools?: ReactNode }) {
  const full = state.full;
  const fullIcon = full ? "M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" : "M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4";
  return (
    <div className="absolute top-3 left-3 z-10 flex items-start gap-2">
      <div className="relative">
        <button type="button" className="mbtn" aria-expanded={state.layersOpen} aria-controls="map-layers"
          onClick={() => state.setLayersOpen((open) => !open)}>
          <svg className="ni" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2l6 3.2-6 3.2-6-3.2zM2 8.4l6 3.2 6-3.2M2 11.4l6 3.2 6-3.2" />
          </svg>
          Layers
          <svg className="ni size-3!" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
        </button>
        <LayersPanel state={state} />
      </div>
      <div className="flex" role="group" aria-label="Zoom">
        <button type="button" className="mbtn w-[34px] justify-center rounded-r-none! px-0! text-base"
          aria-label="Zoom in" onClick={() => state.zoomBy(1)}>+</button>
        <button type="button" className="mbtn -ml-px w-[34px] justify-center rounded-l-none! px-0! text-base"
          aria-label="Zoom out" onClick={() => state.zoomBy(-1)}>&minus;</button>
      </div>
      <button type="button" className="mbtn" onClick={state.fitSelection}>Fit selection</button>
      {document.fullscreenEnabled && (
        <button type="button" className="mbtn" aria-pressed={full} onClick={state.toggleFull}>
          <svg className="ni" viewBox="0 0 16 16" aria-hidden="true"><path d={fullIcon} /></svg>
          {full ? "Exit full screen" : "Full screen"}
        </button>
      )}
      {tools}
    </div>
  );
}

// The key doubles as Layers: click an entry to show or hide it (same state as the Layers panel).
function MapKey({ state }: { state: NetworkMapState }) {
  const { routeLayers, siteLayers } = state;
  return (
    <div role="group" aria-label="Map key" className="mleg">
      <p className="mleg-h col-span-2">Route type</p>
      {ROUTE_LAYERS.map(([type, swatch]) => (
        <button key={type} type="button" aria-pressed={routeLayers[type]} aria-label={`Show ${type} lines`}
          onClick={() => state.setRouteLayers({ ...routeLayers, [type]: !routeLayers[type] })}>
          <i className="slot" aria-hidden="true"><i className={swatch} /></i>{type}
        </button>
      ))}
      <span><i className="slot" aria-hidden="true"><i className="ll s" /></i>Selected</span>
      <p className="mleg-h col-span-2">Sites</p>
      {SITE_LAYERS.map(([kind, label, shape]) => (
        <button key={kind} type="button" aria-pressed={siteLayers[kind]} aria-label={`Show ${label}`}
          onClick={() => state.setSiteLayers({ ...siteLayers, [kind]: !siteLayers[kind] })}>
          <i className="slot" aria-hidden="true"><i className={shape} /></i>{KEY_LABEL[kind]}
        </button>
      ))}
    </div>
  );
}

function NotDrawn({ items }: { items: { name: string; reason: string }[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <details className="mt-2 text-xs text-muted-foreground" data-testid="map-not-drawn">
      <summary className="cursor-pointer">
        {plural(items.length, "segment")} not on the map (no coordinates)
      </summary>
      <ul className="mt-1 list-disc pl-5">
        {items.map((item) => (
          <li key={item.name}><b className="font-semibold text-foreground">{item.name}</b>: {item.reason}</li>
        ))}
      </ul>
    </details>
  );
}

function mapMode(base: Basemap): string {
  if (base === "gl") {
    return "gl";
  }
  return base === "loading" ? "loading" : "svg";
}

type NetworkMapProps = {
  tools?: ReactNode; // extra toolbar controls (the Region filter)
  selectedIds: number[];
  routeKey: string | null;
  visible: (segment: SegmentProps) => boolean;
  onSelectSegment: (id: number) => void;
  onSite: (name: string) => void;
  onClear: () => void;
  version: number;
};

export function NetworkMap(props: NetworkMapProps) {
  const { selectedIds, routeKey, visible, onSelectSegment, onSite, onClear, version, tools } = props;
  const state = useNetworkMap({ selectedIds, routeKey, version, onSelectSegment, onClear });
  const { box, glBox, onPointerDown, onPointerMove, onPointerUp } = state;
  const { camera, size } = state;
  const showOverlay = camera != null && size.w > 0;
  const lines = drawnLines(state, visible);
  const sitePoints = (state.data.sites?.features ?? []).map((feature): Point => {
    if (!showOverlay) {
      return [0, 0];
    }
    return project(camera, size, feature.geometry.coordinates);
  });
  const { chipShown, nameShown } = declutter(state, lines, sitePoints);
  let note = NOTE[state.base];
  if (state.data.failed) {
    note = "Could not load the map data. Search and lists still work.";
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      state.setLayersOpen(false);
      onClear();
    }
  };

  // The stage is the growing child: it fills the card when the right column makes the row taller
  // (no blank band under the map). MapLibre follows container size changes itself (ResizeObserver),
  // the overlay via `box`.
  return (
    <div className="flex flex-1 flex-col">
      <p id="map-instr" className="sr-only">
        Chips show free to reserve. Tab to a chip or site and press Enter to select; Esc clears the selection.
      </p>
      <div ref={box} data-testid="network-map" data-mode={mapMode(state.base)}
        className={`relative flex-1 overflow-hidden bg-map select-none ${state.full ? "" : FRAMED_CLASS}`}
        onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}>
        {/* inline style: MapLibre's CSS sets position: relative */}
        <div ref={glBox} style={{ position: "absolute", inset: 0 }} aria-hidden="true" />
        {showOverlay && (
          <>
            <MapLines lines={lines} onSelect={state.selectSegment} />
            <SiteMarkers state={state} sitePoints={sitePoints} nameShown={nameShown} onSite={onSite} />
            {lines.filter((line) => line.show).map((line) => (
              <SegmentChip key={line.segment.segment_id} line={line}
                shown={chipShown.has(line.segment.segment_id)} onSelect={state.selectSegment} />
            ))}
          </>
        )}
        <MapControls state={state} tools={tools} />
        <MapKey state={state} />
        {note && <p role="status" data-testid="map-note" className={NOTE_CLASS}>{note}</p>}
      </div>
      {state.data.segments && <NotDrawn items={state.data.segments.not_drawn} />}
    </div>
  );
}
