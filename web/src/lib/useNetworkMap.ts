import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { api } from "@/api/client";
import { boundsOf, fitView, MALAYSIA, panned, type Camera, type Size } from "@/lib/mapGeometry";
import {
  ALL_ROUTES,
  ALL_SITES,
  routeLayerOn,
  type MapData,
  type RouteLayers,
  type SegmentFeature,
  type SiteFeature,
  type SiteLayers,
} from "@/lib/mapLayers";

export type Basemap = "loading" | "gl" | "missing" | "nogl" | "failed";
const MAX_ZOOM = 18;
const MIN_ZOOM = 4;
const CAMERA_MOVE_MS = 250;
// a press on one of these never starts a drag
const NOT_DRAGGABLE = "button,a,input,label,[data-hit],details";

function hasWebgl(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

function isPmtilesError(event: unknown): boolean {
  const sourceId = (event as { sourceId?: string }).sourceId;
  const message = String((event as { error?: { message?: string } }).error?.message);
  return sourceId === "pm" || /pmtiles/i.test(message);
}

export type NetworkMapOptions = {
  selectedIds: number[];
  routeKey: string | null;
  version: number;
  onSelectSegment: (id: number) => void;
  onClear: () => void;
};

function useFullscreen(box: React.RefObject<HTMLDivElement | null>) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [box]);
  const toggleFull = () => {
    const request = full ? document.exitFullscreen() : box.current!.requestFullscreen();
    request.catch(() => {});
  };
  return { full, toggleFull };
}

function useMapData(version: number) {
  const [segments, setSegments] = useState<MapData<SegmentFeature> | null>(null);
  const [sites, setSites] = useState<MapData<SiteFeature> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([api.get("/api/map/segments"), api.get("/api/map/sites")])
      .then(([loadedSegments, loadedSites]) => {
        if (live) {
          setSegments(loadedSegments as unknown as MapData<SegmentFeature>);
          setSites(loadedSites as unknown as MapData<SiteFeature>);
        }
      })
      .catch(() => {
        if (live) {
          setFailed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [version]);
  return { segments, sites, failed };
}

// Map size from the card; the camera starts on Malaysia (the data fit follows once segments arrive).
type CameraUpdate = (current: Camera | null) => Camera | null;

function useMapSize(box: React.RefObject<HTMLDivElement | null>, setCamera: (update: CameraUpdate) => void) {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const element = box.current!;
    const observer = new ResizeObserver(() => {
      setSize({ w: element.clientWidth, h: element.clientHeight });
      setCamera((current) => {
        if (current || !element.clientWidth) {
          return current;
        }
        return fitView(MALAYSIA, element.clientWidth, element.clientHeight, 8);
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [box, setCamera]);
  return size;
}

// Network map state: data, camera (MapLibre or own), basemap mode, layers, fitting and dragging.
export function useNetworkMap(options: NetworkMapOptions) {
  const { selectedIds, routeKey, version, onSelectSegment, onClear } = options;
  const box = useRef<HTMLDivElement>(null);
  const glBox = useRef<HTMLDivElement>(null);
  const map = useRef<import("maplibre-gl").Map | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [gl] = useState(hasWebgl);
  const [base, setBase] = useState<Basemap>(gl ? "loading" : "nogl");
  const [routeLayers, setRouteLayers] = useState<RouteLayers>(ALL_ROUTES);
  const [trunkOff, setTrunkOff] = useState<Set<string>>(new Set());
  const [siteLayers, setSiteLayers] = useState<SiteLayers>(ALL_SITES);
  const [layersOpen, setLayersOpen] = useState(false);
  const fullscreen = useFullscreen(box);
  const data = useMapData(version);
  const size = useMapSize(box, setCamera);

  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  // Basemap: WebGL and the PMTiles file are both needed, otherwise stay on the SVG overlay.
  const ready = camera != null;
  useEffect(() => {
    if (!ready || !gl) {
      return;
    }
    let live = true;
    import("@/lib/basemap")
      .then(async (basemap) => {
        const installed = await basemap.basemapInstalled();
        if (!live) {
          return;
        }
        if (!installed.tiles) {
          setBase("missing");
          return;
        }
        const start = cameraRef.current!;
        const center: [number, number] = [start.lng, start.lat];
        const created = basemap.createBasemap(glBox.current!, center, start.zoom, installed.glyphs);
        map.current = created;
        // read by the e2e tests (layer checks); harmless otherwise
        (window as { fiberMap?: unknown }).fiberMap = created;
        created.on("move", () => {
          const center = created.getCenter();
          setCamera({ lng: center.lng, lat: center.lat, zoom: created.getZoom() });
        });
        created.on("error", (event) => {
          if (isPmtilesError(event)) {
            setBase("failed");
          }
        });
        setBase("gl");
      })
      .catch(() => {
        if (live) {
          setBase("nogl");
        }
      });
    return () => {
      live = false;
      map.current?.remove();
      map.current = null;
    };
  }, [ready, gl]);

  const go = useCallback((next: Camera) => {
    if (map.current) {
      map.current.easeTo({ center: [next.lng, next.lat], zoom: next.zoom, duration: CAMERA_MOVE_MS });
      return;
    }
    setCamera(next);
  }, []);

  const zoomBy = (step: number) => {
    if (!camera) {
      return;
    }
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom + step));
    go({ ...camera, zoom });
  };

  const features = data.segments?.features ?? [];
  const selected = new Set(selectedIds);

  const fitTo = (ids: number[] | null) => {
    if (!size.w) {
      return;
    }
    const chosen = features.filter((feature) => !ids || ids.includes(feature.properties.segment_id));
    const bounds = boundsOf(chosen.flatMap((feature) => feature.geometry.coordinates));
    if (bounds) {
      go(fitView(bounds, size.w, size.h, ids ? 100 : 70));
    }
  };
  const fitSelection = () => fitTo(selectedIds.length ? selectedIds : null);

  // A segment picked on the map is already in view and stays put;
  // a segment picked anywhere else (the Find list, search) is followed.
  const clicked = useRef<number | null>(null);
  const selectSegment = (id: number) => {
    clicked.current = id;
    onSelectSegment(id);
  };

  // Turning a layer off unselects a single segment it hides; a found route keeps its segments.
  const layersSeen = useRef({ routeLayers, trunkOff });
  useEffect(() => {
    const seen = layersSeen.current;
    if (seen.routeLayers === routeLayers && seen.trunkOff === trunkOff) {
      return;
    }
    layersSeen.current = { routeLayers, trunkOff };
    if (routeKey) {
      return;
    }
    const hidden = (feature: SegmentFeature) => !routeLayerOn(routeLayers, trunkOff, feature.properties);
    const isSelected = (feature: SegmentFeature) => selected.has(feature.properties.segment_id);
    const hidesSelected = features.some((feature) => isSelected(feature) && hidden(feature));
    if (hidesSelected) {
      onClear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on a layer change only
  }, [routeLayers, trunkOff]);

  // First data: fit to the selection if there is one, else to all segments. A new route: fit to its segments.
  const fitted = useRef(false);
  const selectionKey = selectedIds.join(",");
  useEffect(() => {
    if (fitted.current || !data.segments || !size.w || base === "loading") {
      return;
    }
    fitted.current = true;
    fitSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when everything is in
  }, [data.segments, size, base]);
  useEffect(() => {
    if (fitted.current && routeKey && selectedIds.length) {
      fitTo(selectedIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the route changes
  }, [routeKey, selectionKey]);
  useEffect(() => {
    if (!fitted.current || routeKey || selectedIds.length !== 1) {
      return;
    }
    if (clicked.current === selectedIds[0]) {
      clicked.current = null;
      return;
    }
    fitTo(selectedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow a segment selected outside the map
  }, [selectionKey]);

  // SVG mode camera: drag to pan.
  const drag = useRef<{ x: number; y: number; start: Camera } | null>(null);
  const onPointerDown = (event: PointerEvent) => {
    const onControl = (event.target as Element).closest(NOT_DRAGGABLE);
    if (map.current || !camera || onControl) {
      return;
    }
    drag.current = { x: event.clientX, y: event.clientY, start: camera };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    const current = drag.current;
    if (!current) {
      return;
    }
    setCamera(panned(current.start, event.clientX - current.x, event.clientY - current.y));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return {
    box,
    glBox,
    size,
    camera,
    base,
    data,
    features,
    selected,
    routeLayers,
    setRouteLayers,
    trunkOff,
    setTrunkOff,
    siteLayers,
    setSiteLayers,
    layersOpen,
    setLayersOpen,
    ...fullscreen,
    zoomBy,
    fitSelection,
    selectSegment,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}

export type NetworkMapState = ReturnType<typeof useNetworkMap>;
