import { MAX_ZOOM, type Bounds, type Point } from "@/lib/mapGeometry";

// Cluster sectors (GET /api/map/sectors) and crowded site markers: the zoom rules and the grouping.
// A cluster is a small group of nearby sites; only a cluster of 2 or more sites has a sector.

export type SectorProps = { cluster: string; site_count: number; bbox: Bounds };
type PolygonRings = Point[][];
export type SectorFeature = {
  properties: SectorProps;
  geometry: { type: "Polygon"; coordinates: PolygonRings } | { type: "MultiPolygon"; coordinates: PolygonRings[] };
};
export type SectorData = { features: SectorFeature[] };

// Zoomed out a cluster is one label; between these zooms the label fades out and its outline and sites fade in.
// Below FADE_FROM the outline is only a few pixels wide.
const FADE_FROM = 12;
export const FADE_TO = 14;
// Clicking a label fits the cluster, but no further in than this (its bbox is only a few hundred metres).
export const CLUSTER_MAX_ZOOM = 16.5;
// The markers become clickable around the middle of the fade, with a dead band either side so they never flicker.
const SWITCH_ZOOM = (FADE_FROM + FADE_TO) / 2;
const DEAD_BAND = 0.15;
// Sites closer than this on screen share one count badge. Only at the map's max zoom, when sites still overlap,
// does a crowd become a stacked list instead (last resort).
const CROWD_PX = 16;
export const SPREAD_ZOOM = MAX_ZOOM - 0.25;
const SPREAD_OFFSET_PX = 30;
const SPREAD_ROW_PX = 24;

// 0 when zoomed out (label shown, sites hidden), 1 when zoomed in (outline and sites shown).
export function clusterFade(zoom: number): number {
  const share = (zoom - FADE_FROM) / (FADE_TO - FADE_FROM);
  return Math.max(0, Math.min(1, share));
}

export function nextZoomedIn(zoomedIn: boolean, zoom: number): boolean {
  if (zoomedIn) {
    return zoom > SWITCH_ZOOM - DEAD_BAND;
  }
  return zoom >= SWITCH_ZOOM + DEAD_BAND;
}

export function clusterName(value: string | null | undefined): string | null {
  const name = (value ?? "").trim();
  return name || null;
}

// Clusters that have a sector, in name order.
export function clustersOf(sectors: SectorFeature[]): string[] {
  const names = sectors.map((sector) => sector.properties.cluster);
  return [...new Set(names)].sort();
}

// The palette is --cluster-1 .. --cluster-6 in index.css.
const CLUSTER_COLOURS = 6;

// A cluster's tint follows its place in the name-sorted list of all clusters with a sector.
export function clusterColour(clusters: string[], cluster: string): string {
  const index = Math.max(0, clusters.indexOf(cluster));
  return `var(--cluster-${(index % CLUSTER_COLOURS) + 1})`;
}

// Every outer and inner ring of a Polygon or MultiPolygon.
export function sectorRings(sector: SectorFeature): Point[][] {
  if (sector.geometry.type === "Polygon") {
    return sector.geometry.coordinates;
  }
  return sector.geometry.coordinates.flat();
}

export type SiteSpot = { index: number; point: Point };
export type SiteCrowd = { members: SiteSpot[]; center: Point };

function meanPoint(spots: SiteSpot[]): Point {
  const x = spots.reduce((total, spot) => total + spot.point[0], 0) / spots.length;
  const y = spots.reduce((total, spot) => total + spot.point[1], 0) / spots.length;
  return [x, y];
}

// Greedy: each spot not yet taken starts a crowd and takes every free spot within CROWD_PX of it.
// ponytail: O(n²) over the drawn sites; fine for a few hundred, use a grid index if thousands get drawn.
export function crowdsOf(spots: SiteSpot[]): SiteCrowd[] {
  const taken = new Set<number>();
  const crowds: SiteCrowd[] = [];
  spots.forEach((first, i) => {
    if (taken.has(i)) {
      return;
    }
    taken.add(i);
    const members = [first];
    spots.forEach((other, j) => {
      if (taken.has(j)) {
        return;
      }
      const distance = Math.hypot(first.point[0] - other.point[0], first.point[1] - other.point[1]);
      if (distance < CROWD_PX) {
        taken.add(j);
        members.push(other);
      }
    });
    crowds.push({ members, center: meanPoint(members) });
  });
  return crowds;
}

// A spread crowd: one row per site to the right of the crowd, centred on it, so names never overlap.
export function spreadRows(crowd: SiteCrowd): SiteSpot[] {
  const [x, y] = crowd.center;
  const middle = (crowd.members.length - 1) / 2;
  return crowd.members.map((member, row) => {
    const point: Point = [x + SPREAD_OFFSET_PX, y + (row - middle) * SPREAD_ROW_PX];
    return { index: member.index, point };
  });
}
