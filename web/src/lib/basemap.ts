// MapLibre basemap from the self-hosted PMTiles extract (scripts/get-tiles.sh). Loaded with a dynamic import so the
// SVG fallback (no WebGL, no tiles) never downloads MapLibre. Nothing here points outside the app origin.
import { addProtocol, Map as MlMap, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { Protocol } from "pmtiles";

export const PMTILES = "/map/malaysia.pmtiles";
export const GLYPH_PROBE = "/map/fonts/Noto Sans Regular/0-255.pbf";

setWorkerUrl(workerUrl);
addProtocol("pmtiles", new Protocol().tile);

// Light style from the UI tokens (index.css): quiet greys so span colours stay the loudest thing on the map.
// Protomaps v4 layers: earth, water, landuse, roads, boundaries, places. Labels only when the glyphs are installed.
function style(glyphs: boolean): StyleSpecification {
  const src = "pm";
  const s: StyleSpecification = {
    version: 8,
    sources: { [src]: { type: "vector", url: `pmtiles://${location.origin}${PMTILES}`, attribution: "© OpenStreetMap" } },
    layers: [
      { id: "water-bg", type: "background", paint: { "background-color": "#dbe3ec" } },
      { id: "earth", type: "fill", source: src, "source-layer": "earth", paint: { "fill-color": "#f2f4f7" } },
      { id: "landuse", type: "fill", source: src, "source-layer": "landuse", filter: ["in", ["get", "kind"], ["literal", ["park", "forest", "nature_reserve", "wood", "national_park"]]],
        paint: { "fill-color": "#e6ebe4" } },
      { id: "water", type: "fill", source: src, "source-layer": "water", paint: { "fill-color": "#dbe3ec" } },
      { id: "roads-minor", type: "line", source: src, "source-layer": "roads", minzoom: 10, filter: ["in", ["get", "kind"], ["literal", ["minor_road", "other"]]],
        paint: { "line-color": "#e2e5ea", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 14, 2] } },
      { id: "roads-major", type: "line", source: src, "source-layer": "roads", filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
        paint: { "line-color": "#d3d8de", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 14, 3] } },
      { id: "boundaries", type: "line", source: src, "source-layer": "boundaries", filter: ["<=", ["get", "kind_detail"], 4],
        paint: { "line-color": "#a3a9b2", "line-width": 1, "line-dasharray": [3, 2] } },
    ],
  };
  if (glyphs) {
    s.glyphs = "/map/fonts/{fontstack}/{range}.pbf";
    s.layers.push({
      id: "places", type: "symbol", source: src, "source-layer": "places",
      filter: ["in", ["get", "kind"], ["literal", ["country", "region", "locality"]]],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": ["match", ["get", "kind"], "country", 13, "region", 12, 11] },
      paint: { "text-color": "#5b6068", "text-halo-color": "#fff", "text-halo-width": 1.2 },
    });
  }
  return s;
}

// The file is git-ignored and may be missing; Vite then answers 200 with index.html, so check the PMTiles magic bytes.
export async function basemapInstalled(): Promise<{ tiles: boolean; glyphs: boolean }> {
  const tiles = fetch(PMTILES, { headers: { Range: "bytes=0-6" } })
    .then(async (r) => r.ok && new TextDecoder().decode(await r.arrayBuffer()).startsWith("PMTiles")).catch(() => false);
  const glyphs = fetch(GLYPH_PROBE, { method: "HEAD" })
    .then((r) => r.ok && !(r.headers.get("content-type") ?? "").includes("text/html")).catch(() => false);
  return { tiles: await tiles, glyphs: await glyphs };
}

export function createBasemap(container: HTMLElement, center: [number, number], zoom: number, glyphs: boolean) {
  return new MlMap({
    container, style: style(glyphs), center, zoom, minZoom: 4, maxZoom: 16,
    maxBounds: [[95, -4], [124, 12]],
    dragRotate: false, pitchWithRotate: false, touchPitch: false, keyboard: false,
    attributionControl: { compact: true },
  });
}
