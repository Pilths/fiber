import { health } from "@/lib/status";
import { linePath, type DrawnLine, type Point } from "@/lib/mapGeometry";
import { chipText, LINE_COLOR, LINE_WIDTH, lineKind, plural, siteLayerOn, siteLook } from "@/lib/mapLayers";
import type { NetworkMapState } from "@/lib/useNetworkMap";

// The network map overlay: segment lines, site markers and free-cores chips.

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

export function MapLines({ lines, onSelect }: { lines: DrawnLine[]; onSelect: (id: number) => void }) {
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

export function SiteMarkers({ state, sitePoints, nameShown, onSite }: {
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

export function SegmentChip({ line, shown, onSelect }: SegmentChipProps) {
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
