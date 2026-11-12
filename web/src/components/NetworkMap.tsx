import type { ReactNode } from "react";
import { declutter, drawnLines, project, type Point } from "@/lib/mapGeometry";
import type { SegmentProps } from "@/lib/mapLayers";
import { useNetworkMap, type Basemap } from "@/lib/useNetworkMap";
import { MapLines, SegmentChip, SiteMarkers } from "@/components/MapOverlay";
import { MapControls, MapKey, NotDrawn } from "@/components/MapPanels";

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
const NOTE_CLASS =
  "absolute top-3 right-3 z-10 max-w-[340px] note px-3 py-1.5 text-xs font-medium text-amber";
const FRAMED_CLASS = "min-h-[clamp(520px,calc(100vh-210px),860px)] rounded-md border border-border";

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
