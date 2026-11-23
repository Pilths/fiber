import type { FeatureCollection, Geometry, Point } from "geojson";
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from "maplibre-gl";

// Saved KMZ elements (GET /api/map/kmz-elements) as MapLibre layers. They sit on the GL map, so the SVG overlay
// (segment lines, chips, site markers) always draws above them and keeps every click. Hover only: a tooltip with
// the element and group name. Only type imports here, so the SVG fallback never loads MapLibre.
// ponytail: GL only; the SVG fallback (no WebGL or no tiles) does not draw KMZ elements.

export type KmzStyle = {
  line_colour?: string;
  line_opacity?: number;
  line_width?: number;
  fill_colour?: string;
  fill_opacity?: number;
  fill?: boolean;
  outline?: boolean;
};
export type KmzElementProps = {
  element_id: number;
  element_name: string;
  kind: "point" | "line" | "area";
  group_id: number;
  group_name: string;
  colour_mode: "theme" | "kmz";
  kmz_style: KmzStyle;
  target: "segment" | "site" | "cluster";
  cluster_name: string | null;
  label_point: [number, number] | null;
};
export type KmzElements = FeatureCollection<Geometry, KmzElementProps>;
export type KmzTip = { x: number; y: number; name: string; group: string };

const SOURCE = "kmz";
const LABEL_SOURCE = "kmz-labels";
const HOVER_LAYERS = ["kmz-fill", "kmz-solid", "kmz-dashed", "kmz-points"];
const ALL_LAYERS = [...HOVER_LAYERS, "kmz-labels"];
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

// Theme look: a quiet grey that does not compete with the route-type colours.
const THEME_FILL_OPACITY = 0.08;
const THEME_LINE_OPACITY = 0.9;
const THEME_LINE_WIDTH = 1.5;
const FALLBACK_INK = "#5b6068";

function themeColour(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--muted-ink").trim();
  if (value) {
    return value;
  }
  return FALLBACK_INK;
}

// The colours one element is drawn with, as flat properties the layers read with ["get", ...].
// KMZ mode takes the element's own style; a key the KMZ did not set falls back to the theme.
function lookOf(props: KmzElementProps, theme: string) {
  const look = {
    fill_colour: theme,
    fill_opacity: THEME_FILL_OPACITY,
    line_colour: theme,
    line_opacity: THEME_LINE_OPACITY,
    line_width: THEME_LINE_WIDTH,
  };
  if (props.colour_mode !== "kmz") {
    return look;
  }
  const style = props.kmz_style;
  look.fill_colour = style.fill_colour ?? theme;
  look.fill_opacity = style.fill_opacity ?? THEME_FILL_OPACITY;
  look.line_colour = style.line_colour ?? theme;
  look.line_opacity = style.line_opacity ?? THEME_LINE_OPACITY;
  look.line_width = style.line_width ?? THEME_LINE_WIDTH;
  if (style.fill === false) {
    look.fill_opacity = 0;
  }
  if (props.kind === "area" && style.outline === false) {
    look.line_opacity = 0;
  }
  return look;
}

function drawnData(elements: KmzElements): FeatureCollection {
  const theme = themeColour();
  const features = elements.features.map((feature) => {
    const properties = { ...feature.properties, ...lookOf(feature.properties, theme) };
    return { ...feature, properties };
  });
  return { type: "FeatureCollection", features };
}

// One label per cluster area, at a point inside it (label_point from the API).
function labelData(elements: KmzElements): FeatureCollection<Point> {
  const features = [];
  for (const feature of elements.features) {
    const { label_point, cluster_name } = feature.properties;
    if (label_point && cluster_name) {
      const geometry: Point = { type: "Point", coordinates: label_point };
      features.push({ type: "Feature" as const, geometry, properties: { cluster_name } });
    }
  }
  return { type: "FeatureCollection", features };
}

const isKind = (kind: string): ExpressionSpecification => ["==", ["get", "kind"], kind];
const isMode = (mode: string): ExpressionSpecification => ["==", ["get", "colour_mode"], mode];

// Adds the (empty) sources and layers once the style has loaded; glyphs: the label fonts are installed.
export function addKmzLayers(map: MlMap, glyphs: boolean, onHover: (tip: KmzTip | null) => void) {
  map.addSource(SOURCE, { type: "geojson", data: EMPTY });
  map.addSource(LABEL_SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: "kmz-fill", type: "fill", source: SOURCE, filter: isKind("area"),
    paint: { "fill-color": ["get", "fill_colour"], "fill-opacity": ["get", "fill_opacity"] },
  });
  // Area outlines, and lines in KMZ mode: solid.
  map.addLayer({
    id: "kmz-solid", type: "line", source: SOURCE,
    filter: ["any", isKind("area"), ["all", isKind("line"), isMode("kmz")]],
    paint: {
      "line-color": ["get", "line_colour"],
      "line-opacity": ["get", "line_opacity"],
      "line-width": ["get", "line_width"],
    },
  });
  // Lines in theme mode: thin dashed, so they never read as a segment.
  map.addLayer({
    id: "kmz-dashed", type: "line", source: SOURCE, filter: ["all", isKind("line"), isMode("theme")],
    paint: {
      "line-color": ["get", "line_colour"],
      "line-opacity": ["get", "line_opacity"],
      "line-width": ["get", "line_width"],
      "line-dasharray": [3, 2],
    },
  });
  map.addLayer({
    id: "kmz-points", type: "circle", source: SOURCE, filter: isKind("point"),
    paint: {
      "circle-radius": 4,
      "circle-color": "#fff",
      "circle-stroke-color": ["get", "line_colour"],
      "circle-stroke-width": 1.5,
    },
  });
  if (glyphs) {
    map.addLayer({
      id: "kmz-labels", type: "symbol", source: LABEL_SOURCE,
      layout: { "text-field": ["get", "cluster_name"], "text-font": ["Noto Sans Regular"], "text-size": 12 },
      paint: { "text-color": "#3d4046", "text-halo-color": "#fff", "text-halo-width": 1.4 },
    });
  }
  map.on("mousemove", HOVER_LAYERS, (event) => {
    const props = event.features?.[0]?.properties as KmzElementProps | undefined;
    if (!props) {
      return;
    }
    onHover({ x: event.point.x, y: event.point.y, name: props.element_name, group: props.group_name });
  });
  map.on("mouseleave", HOVER_LAYERS, () => onHover(null));
  // the pointer moved onto the overlay (a line, chip or site) or off the map
  map.on("mouseout", () => onHover(null));
}

// Fills the layers added by addKmzLayers and shows or hides them; does nothing before they exist.
export function showKmzElements(map: MlMap, elements: KmzElements | null, on: boolean) {
  const source = map.getSource<GeoJSONSource>(SOURCE);
  const labels = map.getSource<GeoJSONSource>(LABEL_SOURCE);
  if (!source || !labels) {
    return;
  }
  const empty: KmzElements = { type: "FeatureCollection", features: [] };
  const shown = elements ?? empty;
  source.setData(drawnData(shown));
  labels.setData(labelData(shown));
  const visibility = on ? "visible" : "none";
  for (const id of ALL_LAYERS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", visibility);
    }
  }
}
