import { useRef, type ReactNode, type RefObject } from "react";
import { sectorClusters, sectorLabels, siteLayout } from "@/lib/clusterLayout";
import { clustersOf } from "@/lib/mapClusters";
import { declutter, drawnLines } from "@/lib/mapGeometry";
import type { SegmentProps } from "@/lib/mapLayers";
import type { Basemap, NetworkMapState } from "@/lib/useNetworkMap";
import { MapLines, SegmentChip, type ChipUsage } from "@/components/MapOverlay";
import { MapControls, NotDrawn } from "@/components/MapPanels";
import { SectorLabels, SectorShapes } from "@/components/MapSectors";
import { SiteMarkers } from "@/components/MapSites";
import { requestName, type CustomerHighlight } from "@/lib/useCustomerHighlight";

// Network map card body (TASK-054, TASK-055). The caller owns the state (useNetworkMap), so the layer filters
// can sit outside the map (MapFilterPanel in the Site A to B panel).
// One overlay draws segments (SVG lines), free-cores chips and site markers (DOM buttons, app font, Tab reachable) in both modes:
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
// The caller sets the height (the map card); the stage fills it.
const FRAMED_CLASS = "rounded-md border border-border";

function mapMode(base: Basemap): string {
  if (base === "gl") {
    return "gl";
  }
  return base === "loading" ? "loading" : "svg";
}

type NetworkMapProps = {
  state: NetworkMapState;
  tools?: ReactNode; // extra toolbar controls (the customer chip)
  visible: (segment: SegmentProps) => boolean;
  onClear: () => void;
  customer?: CustomerHighlight | null; // customer mode: its chips show used cores
  onEmptyClick?: () => void;
};

const CLICK_SLOP_PX = 4;

// A click on bare map (not a drag, not a line, chip, site or control).
function useEmptyMapClick(box: RefObject<HTMLDivElement | null>, glBox: RefObject<HTMLDivElement | null>,
  onEmptyClick?: () => void) {
  const press = useRef<[number, number] | null>(null);
  const onPointerDownCapture = (event: React.PointerEvent) => {
    press.current = [event.clientX, event.clientY];
  };
  const onClick = (event: React.MouseEvent) => {
    const start = press.current;
    if (!onEmptyClick || !start) {
      return;
    }
    const moved = Math.hypot(event.clientX - start[0], event.clientY - start[1]) > CLICK_SLOP_PX;
    const target = event.target as Node;
    const bare = target === box.current || glBox.current?.contains(target);
    if (bare && !moved) {
      onEmptyClick();
    }
  };
  return { onPointerDownCapture, onClick };
}

function chipUsage(customer: CustomerHighlight | null | undefined, segmentId: number): ChipUsage | null {
  const used = customer?.used.get(segmentId);
  if (!customer || used == null) {
    return null;
  }
  const request = customer.request ? requestName(customer.request) : null;
  return { customer: customer.name, used, request };
}

export function NetworkMap(props: NetworkMapProps) {
  const { state, visible, onClear, tools, customer } = props;
  const emptyClick = useEmptyMapClick(state.box, state.glBox, props.onEmptyClick);
  const { box, glBox, onPointerDown, onPointerMove, onPointerUp } = state;
  const { camera, size } = state;
  const showOverlay = camera != null && size.w > 0;
  const lines = drawnLines(state, visible);
  const layout = siteLayout(state);
  const labels = sectorLabels(state, layout);
  const sectored = sectorClusters(state);
  const clusters = clustersOf(state.data.sectors?.features ?? []);
  const sectors = (state.data.sectors?.features ?? []).filter((sector) => sectored.has(sector.properties.cluster));
  const usedIds = new Set(customer?.used.keys());
  const { chipShown, nameShown } = declutter(state, lines, layout, labels, usedIds);
  let note = NOTE[state.base];
  if (state.data.failed) {
    note = "Could not load the map data. Search and lists still work.";
  }
  // Esc on a select (the request picker) belongs to the select: the browser uses it to close the list.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLSelectElement) {
      return;
    }
    if (event.key === "Escape") {
      onClear();
    }
  };

  // The stage is the growing child: it fills the card when the right column makes the row taller
  // (no blank band under the map). MapLibre follows container size changes itself (ResizeObserver),
  // the overlay via `box`.
  return (
    <div className="flex flex-1 flex-col">
      <p id="map-instr" className="sr-only">
        Chips show free to reserve. Tab to a chip and press Enter to select; Esc clears the selection.
      </p>
      <div ref={box} data-testid="network-map" data-mode={mapMode(state.base)}
        className={`relative flex-1 overflow-hidden bg-map select-none ${state.full ? "" : FRAMED_CLASS}`}
        onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} {...emptyClick}>
        {/* inline style: MapLibre's CSS sets position: relative */}
        <div ref={glBox} style={{ position: "absolute", inset: 0 }} aria-hidden="true" />
        {showOverlay && (
          <>
            <SectorShapes state={state} sectors={sectors} />
            <MapLines lines={lines} onSelect={state.selectSegment} />
            <SectorLabels labels={labels} clusters={clusters} onZoom={state.zoomToBounds} />
            <SiteMarkers state={state} layout={layout} nameShown={nameShown} />
            {lines.filter((line) => line.show).map((line) => (
              <SegmentChip key={line.segment.segment_id} line={line}
                shown={chipShown.has(line.segment.segment_id)} usage={chipUsage(customer, line.segment.segment_id)}
                onSelect={state.selectSegment} />
            ))}
          </>
        )}
        <MapControls state={state} tools={tools} />
        {note && <p role="status" data-testid="map-note" className={NOTE_CLASS}>{note}</p>}
      </div>
      {state.data.segments && <NotDrawn items={state.data.segments.not_drawn} />}
    </div>
  );
}
