import {
  clusterFade,
  clusterName,
  crowdsOf,
  SPREAD_ZOOM,
  spreadRows,
  type SectorFeature,
  type SiteCrowd,
  type SiteSpot,
} from "@/lib/mapClusters";
import { makePlacer, project, type Point } from "@/lib/mapGeometry";
import { siteLayerOn, type SiteFeature } from "@/lib/mapLayers";
import type { NetworkMapState } from "@/lib/useNetworkMap";

// Where the site markers, count badges, spread lists and campus labels go for the current camera.

// Below this a fading marker or label is not drawn at all (so it is neither seen nor reached by Tab).
const MIN_OPACITY = 0.05;

export type PlacedSite = SiteSpot & { opacity: number; active: boolean; end: boolean; spread: boolean };
export type SiteBadge = { crowd: SiteCrowd; opacity: number; active: boolean };
export type SiteSpread = { center: Point; rows: PlacedSite[] };
export type SiteLayout = { sites: PlacedSite[]; badges: SiteBadge[]; spreads: SiteSpread[] };
export type SectorLabel = {
  sector: SectorFeature;
  names: string[];
  point: Point;
  opacity: number;
  active: boolean;
  named: boolean; // the campus name shows beside the count badge
  box: number[]; // screen box of the badge, and of the name when it shows
};

// The end sites of the selected segment or route: always drawn, never merged into a badge.
export function endSiteIds(state: NetworkMapState): Set<number> {
  const ends = new Set<number>();
  for (const feature of state.features) {
    if (state.selected.has(feature.properties.segment_id)) {
      ends.add(feature.properties.site_a_id);
      ends.add(feature.properties.site_b_id);
    }
  }
  return ends;
}

// Clusters drawn as a sector: every cluster that has one.
export function sectorClusters(state: NetworkMapState): Set<string> {
  const sectors = state.data.sectors?.features ?? [];
  return new Set(sectors.map((sector) => sector.properties.cluster));
}

type SiteLook = { opacity: number; active: boolean; crowds: boolean };

// A site in a drawn campus fades in with the zoom; every other site is always fully shown. While the campus label
// shows, its sites are grouped under the label, not by pixel distance; zoomed in they crowd like any other site.
function siteLooks(state: NetworkMapState, sectored: Set<string>, zoom: number): (SiteLook | null)[] {
  const fade = clusterFade(zoom);
  return (state.data.sites?.features ?? []).map((feature) => {
    const site = feature.properties;
    if (!siteLayerOn(state.siteLayers, site.kind)) {
      return null;
    }
    const cluster = clusterName(site.cluster);
    if (!cluster || !sectored.has(cluster)) {
      return { opacity: 1, active: true, crowds: true };
    }
    if (fade < MIN_OPACITY) {
      return null;
    }
    return { opacity: fade, active: state.zoomedIn, crowds: state.zoomedIn };
  });
}

function placed(spot: SiteSpot, look: SiteLook, end: boolean, spread: boolean): PlacedSite {
  return { ...spot, opacity: look.opacity, active: look.active, end, spread };
}

export function siteLayout(state: NetworkMapState): SiteLayout {
  const layout: SiteLayout = { sites: [], badges: [], spreads: [] };
  const { camera, size } = state;
  if (!camera || !size.w) {
    return layout;
  }
  const features = state.data.sites?.features ?? [];
  const ends = endSiteIds(state);
  const looks = siteLooks(state, sectorClusters(state), camera.zoom);
  const crowdable: SiteSpot[] = [];
  features.forEach((feature, index) => {
    const point = project(camera, size, feature.geometry.coordinates);
    if (ends.has(feature.properties.site_id)) {
      layout.sites.push(placed({ index, point }, { opacity: 1, active: true, crowds: false }, true, false));
      return;
    }
    const look = looks[index];
    if (!look) {
      return;
    }
    if (look.crowds) {
      crowdable.push({ index, point });
    } else {
      layout.sites.push(placed({ index, point }, look, false, false));
    }
  });
  for (const crowd of crowdsOf(crowdable)) {
    const lookOf = (spot: SiteSpot) => looks[spot.index]!;
    if (crowd.members.length === 1) {
      const only = crowd.members[0];
      layout.sites.push(placed(only, lookOf(only), false, false));
    } else if (camera.zoom >= SPREAD_ZOOM) {
      const rows = spreadRows(crowd).map((row) => placed(row, lookOf(row), false, true));
      layout.spreads.push({ center: crowd.center, rows });
      layout.sites.push(...rows);
    } else {
      const opacity = Math.max(...crowd.members.map((member) => lookOf(member).opacity));
      const active = crowd.members.some((member) => lookOf(member).active);
      layout.badges.push({ crowd, opacity, active });
    }
  }
  return layout;
}

function campusSites(state: NetworkMapState, sector: SectorFeature): SiteFeature[] {
  const name = sector.properties.cluster;
  return (state.data.sites?.features ?? []).filter((feature) => clusterName(feature.properties.cluster) === name);
}

// The label sits at the mean of the campus's sites; the bbox centre when none of them is on the map.
function labelPoint(sector: SectorFeature, members: SiteFeature[]): Point {
  if (members.length === 0) {
    const [west, south, east, north] = sector.properties.bbox;
    return [(west + east) / 2, (south + north) / 2];
  }
  const lng = members.reduce((total, feature) => total + feature.geometry.coordinates[0], 0) / members.length;
  const lat = members.reduce((total, feature) => total + feature.geometry.coordinates[1], 0) / members.length;
  return [lng, lat];
}

// A campus label is a count badge (24 px click target) with the campus name in small text to its right.
const BADGE_HALF = 12;
const NAME_GAP = 2;
const NAME_CHAR_PX = 6.5; // 11px bold
const NAME_HEIGHT = 16;

function nameWidth(cluster: string): number {
  return NAME_CHAR_PX * cluster.length;
}

function labelBox(point: Point, cluster: string, named: boolean): number[] {
  const [x, y] = point;
  let right = x + BADGE_HALF;
  if (named) {
    right += NAME_GAP + nameWidth(cluster);
  }
  return [x - BADGE_HALF, y - BADGE_HALF, right, y + BADGE_HALF];
}

const SITE_HALF = 12; // half a site marker's box
const SITE_NAME_TOP = 8; // a site name's top below its marker's centre
const SITE_NAME_HEIGHT = 18;
const SITE_NAME_CHAR_PX = 7.2;

// What a campus name must not cover: every drawn site marker and the names of the selection's end sites (those
// always show). Other site names give way to the label in the map's declutter.
function siteBoxes(state: NetworkMapState, layout: SiteLayout): number[][] {
  const features = state.data.sites?.features ?? [];
  const boxes: number[][] = [];
  for (const site of layout.sites) {
    const [x, y] = site.point;
    boxes.push([x - SITE_HALF, y - SITE_HALF, x + SITE_HALF, y + SITE_HALF]);
    if (site.end) {
      const half = (SITE_NAME_CHAR_PX * features[site.index].properties.name.length + 12) / 2;
      boxes.push([x - half, y + SITE_NAME_TOP, x + half, y + SITE_NAME_TOP + SITE_NAME_HEIGHT]);
    }
  }
  return boxes;
}

// Every badge shows; a name that would overlap another campus's badge, an earlier name or a site (see siteBoxes)
// is dropped.
function nameLabels(labels: SectorLabel[], sites: number[][]): SectorLabel[] {
  const placer = makePlacer([...sites, ...labels.map((label) => label.box)]);
  return labels.map((label) => {
    const [x, y] = label.point;
    const cluster = label.sector.properties.cluster;
    const width = nameWidth(cluster);
    const centerX = x + BADGE_HALF + NAME_GAP + width / 2;
    const named = placer.fits(centerX, y, width, NAME_HEIGHT);
    return { ...label, named, box: labelBox(label.point, cluster, named) };
  });
}

export function sectorLabels(state: NetworkMapState, layout: SiteLayout): SectorLabel[] {
  const { camera, size } = state;
  if (!camera || !size.w) {
    return [];
  }
  const opacity = 1 - clusterFade(camera.zoom);
  if (opacity < MIN_OPACITY) {
    return [];
  }
  const sectored = sectorClusters(state);
  const shown = (state.data.sectors?.features ?? []).filter((sector) => sectored.has(sector.properties.cluster));
  const labels = shown.map((sector) => {
    const members = campusSites(state, sector);
    const point = project(camera, size, labelPoint(sector, members));
    const names = members.map((feature) => feature.properties.name);
    const box = labelBox(point, sector.properties.cluster, false);
    return { sector, names, point, opacity, active: !state.zoomedIn, named: false, box };
  });
  return nameLabels(labels, siteBoxes(state, layout));
}
