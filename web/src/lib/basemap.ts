// MapLibre basemap from the self-hosted PMTiles extract (scripts/get-tiles.sh). Loaded with a dynamic import so the
// SVG fallback (no WebGL, no tiles) never downloads MapLibre. Nothing here points outside the app origin.
import { addProtocol, Map as MlMap, setWorkerUrl, type ExpressionSpecification, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { Protocol } from "pmtiles";

export const PMTILES = "/map/malaysia.pmtiles";
export const GLYPH_PROBE = "/map/fonts/Noto Sans Regular/0-255.pbf";

setWorkerUrl(workerUrl);
addProtocol("pmtiles", new Protocol().tile);

// Light style from the UI tokens (index.css): quiet greys so span colours stay the loudest thing on the map.
// Protomaps v4 layers used: earth, water, landuse, roads, buildings, boundaries, places, pois. The extract stops at
// zoom 14; MapLibre overzooms those tiles up to the map's maxZoom, so buildings and streets stay drawn when zoomed in.
// Labels (places, street names, a few landmark POIs) only when the glyphs are installed.
const PATHS = ["path"]; // footway, pedestrian, steps, sidewalk, crossing, cycleway, track, corridor ... (kind_detail)
const LANDMARKS = ["station", "hospital", "mall", "university", "college", "stadium", "police", "fire_station"];
const zw = (z0: number, w0: number, z1: number, w1: number): ExpressionSpecification => ["interpolate", ["exponential", 1.6], ["zoom"], z0, w0, z1, w1];

function style(glyphs: boolean): StyleSpecification {
  const src = "pm";
  const kind = (k: string[]): ExpressionSpecification => ["in", ["get", "kind"], ["literal", k]];
  const s: StyleSpecification = {
    version: 8,
    sources: { [src]: { type: "vector", url: `pmtiles://${location.origin}${PMTILES}`, attribution: "© OpenStreetMap" } },
    layers: [
      { id: "water-bg", type: "background", paint: { "background-color": "#dbe3ec" } },
      { id: "earth", type: "fill", source: src, "source-layer": "earth", paint: { "fill-color": "#f2f4f7" } },
      { id: "landuse", type: "fill", source: src, "source-layer": "landuse", filter: kind(["park", "forest", "nature_reserve", "wood", "national_park", "garden", "grass"]),
        paint: { "fill-color": "#e6ebe4" } },
      { id: "water", type: "fill", source: src, "source-layer": "water", paint: { "fill-color": "#dbe3ec" } },
      { id: "buildings", type: "fill", source: src, "source-layer": "buildings", minzoom: 13,
        paint: { "fill-color": "#e4e7eb", "fill-outline-color": "#cfd4da", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 1] } },
      { id: "paths", type: "line", source: src, "source-layer": "roads", minzoom: 14, filter: kind(PATHS),
        paint: { "line-color": "#9aa1ab", "line-width": zw(14, 0.6, 18, 1.5), "line-dasharray": [2, 1.5] } },
      { id: "rail", type: "line", source: src, "source-layer": "roads", minzoom: 11, filter: ["==", ["get", "kind"], "rail"],
        paint: { "line-color": "#c3c8cf", "line-width": zw(11, 0.6, 18, 2) } },
      { id: "roads-minor", type: "line", source: src, "source-layer": "roads", minzoom: 10, filter: kind(["minor_road", "other"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#e2e5ea", "line-width": zw(10, 0.5, 18, 10) } },
      { id: "roads-major", type: "line", source: src, "source-layer": "roads", filter: kind(["highway", "major_road"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#d3d8de", "line-width": zw(5, 0.4, 18, 16) } },
      { id: "boundaries", type: "line", source: src, "source-layer": "boundaries", filter: ["<=", ["get", "kind_detail"], 4],
        paint: { "line-color": "#a3a9b2", "line-width": 1, "line-dasharray": [3, 2] } },
    ],
  };
  if (glyphs) {
    s.glyphs = "/map/fonts/{fontstack}/{range}.pbf";
    const text = { "text-color": "#5b6068", "text-halo-color": "#fff", "text-halo-width": 1.2 };
    s.layers.push(
      { id: "street-names", type: "symbol", source: src, "source-layer": "roads", minzoom: 14,
        filter: ["all", kind(["highway", "major_road", "minor_road", "path"]), ["has", "name"]],
        layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11 },
        paint: text },
      { id: "landmarks", type: "symbol", source: src, "source-layer": "pois", minzoom: 15, filter: kind(LANDMARKS),
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-max-width": 8 },
        paint: { ...text, "text-color": "#50555d" } },
      { id: "places", type: "symbol", source: src, "source-layer": "places",
        filter: kind(["country", "region", "locality", "neighbourhood"]),
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": ["match", ["get", "kind"], "country", 13, "region", 12, 11] },
        paint: text },
    );
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
    container, style: style(glyphs), center, zoom, minZoom: 4, maxZoom: 18, // tiles stop at 14; MapLibre overzooms them
    maxBounds: [[95, -4], [124, 12]],
    dragRotate: false, pitchWithRotate: false, touchPitch: false, keyboard: false,
    attributionControl: { compact: true },
  });
}
