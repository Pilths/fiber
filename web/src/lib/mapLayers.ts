import type { Point } from "@/lib/mapGeometry";

export type SegmentProps = {
  segment_id: number;
  name: string;
  site_a_id: number;
  site_b_id: number;
  route_type: string | null;
  region: string | null;
  route: string | null;
  site_a_kind: string;
  site_b_kind: string;
  distance_km: string | null;
  free_to_reserve: number;
  surveyed: boolean;
  chip: "ok" | "low" | "full" | "not_surveyed";
  fiber_cut?: boolean;
  route_id: number | null;
  shaped?: boolean;
};
export type SiteProps = {
  site_id: number;
  name: string;
  kind: string;
  lrd_site_id: number | null;
  region: string | null;
  location_from_site?: string;
};
export type SegmentFeature = { properties: SegmentProps; geometry: { coordinates: Point[] } };
export type SiteFeature = { properties: SiteProps; geometry: { coordinates: Point } };
export type MapData<Feature> = { features: Feature[]; not_drawn: { name: string; reason: string }[] };

// Line width and colour per route type. Each type also has its own pattern (Trunk solid, Metro long dash and
// dot, DC-DC double, DC-TOC dashed; not verified dotted), so the colour is never the only cue. The Layers and key
// swatches (.ll in index.css) draw the same patterns. Free-core health is on the chips, not the lines.
export const LINE_WIDTH: Record<string, number> = { trunk: 6, "dc-dc": 7, "dc-toc": 4, metro: 4 };
export const LINE_COLOR: Record<string, string> = {
  trunk: "var(--line-trunk)",
  metro: "var(--line-metro)",
  "dc-dc": "var(--line-dcdc)",
  "dc-toc": "var(--line-dctoc)",
};

// Layers: which route types, trunk routes and site kinds show on the map. A hidden line or site is not
// drawn at all; the selected segment or route and its end sites always show.
// Route search still uses hidden segments.
export type SiteLayers = { data_center: boolean; toc: boolean; site: boolean };
export const ALL_SITES: SiteLayers = { data_center: true, toc: true, site: true };
export const SITE_LAYERS: [keyof SiteLayers, string, string][] = [
  ["data_center", "Data centres", "rb-sh dc"],
  ["toc", "TOC", "rb-sh toc"],
  ["site", "Trunk sites", "rb-sh st"],
];
export const ROUTE_LAYERS: [string, string][] = [
  ["Trunk", "ll"],
  ["Metro", "ll m"],
  ["DC-DC", "ll dd"],
  ["DC-TOC", "ll dt"],
];
export type RouteLayers = Record<string, boolean>;
export const ALL_ROUTES: RouteLayers = { Trunk: true, Metro: true, "DC-DC": true, "DC-TOC": true };

export function siteLayerOn(layers: SiteLayers, kind: string): boolean {
  if (kind === "data_center" || kind === "toc") {
    return layers[kind];
  }
  return layers.site;
}

export function routeLayerOn(layers: RouteLayers, trunkOff: Set<string>, segment: SegmentProps): boolean {
  const type = segment.route_type ?? "";
  if (layers[type] === false) {
    return false;
  }
  if (type === "Trunk" && segment.route && trunkOff.has(segment.route)) {
    return false;
  }
  return true;
}

// Trunk routes (R1, R3, ...) on the map, in name order: one on/off chip each on the Trunk row.
export function trunkRoutesOf(features: SegmentFeature[]): string[] {
  const routes = new Set<string>();
  for (const feature of features) {
    const segment = feature.properties;
    if (segment.route_type === "Trunk" && segment.route) {
      routes.add(segment.route);
    }
  }
  return [...routes].sort();
}

export function lineKind(routeType: string | null): string {
  return (routeType ?? "").toLowerCase();
}

// Map shape and spoken word per site kind: DC a dark square, TOC a dark triangle, a trunk site a diamond.
export function siteLook(kind: string): { shape: string; word: string } {
  if (kind === "data_center") {
    return { shape: "dc", word: "data centre" };
  }
  if (kind === "toc") {
    return { shape: "toc", word: "TOC" };
  }
  return { shape: "st", word: "trunk site" };
}

// Chip text: the free-core number only; a cut segment reads 0, not surveyed a dash.
export function chipText(segment: SegmentProps): string {
  if (segment.fiber_cut) {
    return "0";
  }
  if (segment.surveyed) {
    return String(segment.free_to_reserve);
  }
  return "–";
}

