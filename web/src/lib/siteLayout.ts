import { MAX_ZOOM, project, type Point } from "@/lib/mapGeometry";
import { siteLayerOn } from "@/lib/mapLayers";
import type { NetworkMapState } from "@/lib/useNetworkMap";

// Where the site markers, count badges and spread lists go for the current camera.

// Sites closer than this on screen share one count badge. Only at the map's max zoom, when sites still overlap,
// does a crowd become a stacked list instead (last resort).
const CROWD_PX = 16;
const SPREAD_ZOOM = MAX_ZOOM - 0.25;
const SPREAD_OFFSET_PX = 30;
const SPREAD_ROW_PX = 24;

type SiteSpot = { index: number; point: Point };
type SiteCrowd = { members: SiteSpot[]; center: Point };

export type PlacedSite = SiteSpot & { end: boolean; spread: boolean };
export type SiteBadge = { crowd: SiteCrowd };
export type SiteSpread = { center: Point; rows: PlacedSite[] };
export type SiteLayout = { sites: PlacedSite[]; badges: SiteBadge[]; spreads: SiteSpread[] };

function meanPoint(spots: SiteSpot[]): Point {
  const x = spots.reduce((total, spot) => total + spot.point[0], 0) / spots.length;
  const y = spots.reduce((total, spot) => total + spot.point[1], 0) / spots.length;
  return [x, y];
}

// Greedy: each spot not yet taken starts a crowd and takes every free spot within CROWD_PX of it.
// ponytail: O(n²) over the drawn sites; fine for a few hundred, use a grid index if thousands get drawn.
function crowdsOf(spots: SiteSpot[]): SiteCrowd[] {
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
function spreadRows(crowd: SiteCrowd): SiteSpot[] {
  const [x, y] = crowd.center;
  const middle = (crowd.members.length - 1) / 2;
  return crowd.members.map((member, row) => {
    const point: Point = [x + SPREAD_OFFSET_PX, y + (row - middle) * SPREAD_ROW_PX];
    return { index: member.index, point };
  });
}

// The end sites of the selected segment or route: always drawn, never merged into a badge.
function endSiteIds(state: NetworkMapState): Set<number> {
  const ends = new Set<number>();
  for (const feature of state.features) {
    if (state.selected.has(feature.properties.segment_id)) {
      ends.add(feature.properties.site_a_id);
      ends.add(feature.properties.site_b_id);
    }
  }
  return ends;
}

export function siteLayout(state: NetworkMapState): SiteLayout {
  const layout: SiteLayout = { sites: [], badges: [], spreads: [] };
  const { camera, size } = state;
  if (!camera || !size.w) {
    return layout;
  }
  const features = state.data.sites?.features ?? [];
  const ends = endSiteIds(state);
  const crowdable: SiteSpot[] = [];
  features.forEach((feature, index) => {
    const point = project(camera, size, feature.geometry.coordinates);
    if (ends.has(feature.properties.site_id)) {
      layout.sites.push({ index, point, end: true, spread: false });
      return;
    }
    if (siteLayerOn(state.siteLayers, feature.properties.kind)) {
      crowdable.push({ index, point });
    }
  });
  for (const crowd of crowdsOf(crowdable)) {
    if (crowd.members.length === 1) {
      layout.sites.push({ ...crowd.members[0], end: false, spread: false });
    } else if (camera.zoom >= SPREAD_ZOOM) {
      const rows = spreadRows(crowd).map((row) => ({ ...row, end: false, spread: true }));
      layout.spreads.push({ center: crowd.center, rows });
      layout.sites.push(...rows);
    } else {
      layout.badges.push({ crowd });
    }
  }
  return layout;
}
