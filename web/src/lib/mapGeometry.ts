import { chipText, routeLayerOn, type SegmentProps } from "@/lib/mapLayers";
import type { NetworkMapState } from "@/lib/useNetworkMap";
import type { SiteLayout } from "@/lib/siteLayout";

// Web Mercator at 512 px tiles, the same as MapLibre, so the overlay lines up with the basemap.

export type Camera = { lng: number; lat: number; zoom: number };
export type Bounds = [number, number, number, number]; // west, south, east, north
export type Point = [number, number];
export type Size = { w: number; h: number };

export const MALAYSIA: Bounds = [99.5, 0.8, 119.5, 7.5];
export const TILE = 512;
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 18;
const MAX_FIT_ZOOM = 12;

export function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

export function mercatorY(lat: number): number {
  const sine = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
}

export function latitudeOf(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

function pixelsPerWorld(zoom: number): number {
  return TILE * 2 ** zoom;
}

export function fitView(
  [west, south, east, north]: Bounds,
  width: number,
  height: number,
  pad = 60,
  maxZoom = MAX_FIT_ZOOM,
): Camera {
  const spanX = Math.max(mercatorX(east) - mercatorX(west), 1e-4);
  const spanY = Math.max(mercatorY(south) - mercatorY(north), 1e-4);
  const scaleX = (width - 2 * pad) / (spanX * TILE);
  const scaleY = (height - 2 * pad) / (spanY * TILE);
  const zoom = Math.min(maxZoom, Math.max(MIN_ZOOM, Math.log2(Math.min(scaleX, scaleY))));
  const lat = latitudeOf((mercatorY(south) + mercatorY(north)) / 2);
  return { lng: (west + east) / 2, lat, zoom };
}

export function boundsOf(points: Point[]): Bounds | null {
  if (!points.length) {
    return null;
  }
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Screen position of a lng/lat point for this camera and map size.
export function project(camera: Camera, size: Size, coordinate: Point): Point {
  const scale = pixelsPerWorld(camera.zoom);
  const x = (mercatorX(coordinate[0]) - mercatorX(camera.lng)) * scale + size.w / 2;
  const y = (mercatorY(coordinate[1]) - mercatorY(camera.lat)) * scale + size.h / 2;
  return [x, y];
}

// The camera after dragging by (dx, dy) pixels from where the drag started.
export function panned(start: Camera, dx: number, dy: number): Camera {
  const scale = pixelsPerWorld(start.zoom);
  const lng = start.lng - (dx / scale) * 360;
  const lat = latitudeOf(mercatorY(start.lat) - dy / scale);
  return { ...start, lng, lat };
}

// Point at half the drawn length, so a chip sits on its line even when the line is shaped.
export function midpoint(points: Point[]): Point {
  const lengths = points.slice(1).map((point, i) => {
    const previous = points[i];
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]);
  });
  let half = lengths.reduce((total, length) => total + length, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    const last = i === lengths.length - 1;
    if (half <= lengths[i] || last) {
      const share = lengths[i] ? Math.min(1, half / lengths[i]) : 0;
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      return [x0 + (x1 - x0) * share, y0 + (y1 - y0) * share];
    }
    half -= lengths[i];
  }
  return points[0];
}

// Greedy declutter: each box is placed only if it overlaps nothing placed before it.
export function makePlacer(reserved: number[][]) {
  const placed = [...reserved];
  const overlaps = (box: number[]) =>
    placed.some((other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]);
  const block = (box: number[]) => {
    placed.push(box);
  };
  const fits = (x: number, y: number, width: number, height: number): boolean => {
    const box = [x - width / 2, y - height / 2, x + width / 2, y + height / 2];
    if (overlaps(box)) {
      return false;
    }
    placed.push(box);
    return true;
  };
  return { fits, block };
}

// Drawing the network overlay: which lines to draw where, and which chips and names fit.

const SITE_HALF = 12; // half the marker box, in px
// Centre of the box checked for a site name, in px below the marker. The box starts where the marker's own box
// ends: the drawn name begins 4px higher, in the marker's click margin, and checking that would hide every name.
const NAME_BELOW = SITE_HALF + 9;
const NAME_ZOOM = 8; // site names show from this zoom; the ends of the selection always do

// Areas kept free of chips and names: the controls (top left) and the key (bottom left).
function reservedAreas(height: number): number[][] {
  return [[0, 0, 380, 50], [0, height - 200, 300, height]];
}

export type DrawnLine = {
  segment: SegmentProps;
  points: Point[];
  selected: boolean;
  show: boolean;
  dim: boolean;
  mid: Point;
};

// Lines to draw, in screen coordinates. Hidden layers drop out unless the line is selected.
export function drawnLines(state: NetworkMapState, visible: (segment: SegmentProps) => boolean): DrawnLine[] {
  const { camera, size, selected } = state;
  if (!camera || !size.w) {
    return [];
  }
  const layered = state.features.filter((feature) => {
    const isSelected = selected.has(feature.properties.segment_id);
    return isSelected || routeLayerOn(state.routeLayers, state.trunkOff, feature.properties);
  });
  return layered.map((feature) => {
    const segment = feature.properties;
    const points = feature.geometry.coordinates.map((coordinate) => project(camera, size, coordinate));
    const isSelected = selected.has(segment.segment_id);
    const show = isSelected || visible(segment);
    const dim = show && !isSelected && selected.size > 0;
    return { segment, points, selected: isSelected, show, dim, mid: midpoint(points) };
  });
}

function chipBox(line: DrawnLine, named: boolean): [number, number, number, number] {
  const { segment, selected, mid } = line;
  const chipWidth = 20 + 7.5 * chipText(segment).length;
  if (selected && named) {
    const labelWidth = Math.max(chipWidth, 7.5 * segment.name.length + 16);
    return [mid[0], mid[1] - 11, labelWidth, 46];
  }
  return [mid[0], mid[1], chipWidth + 4, 24];
}

function nameWidth(name: string): number {
  return 7.2 * name.length + 12;
}

// Declutter, greedy: site markers, badges and spread lists, then the selected chips, then the
// other chips, then site names. A chip or name that would overlap something already placed is hidden
// (visibility: hidden) until the user zooms in. `pinned` (customer mode): chips that always show, over a marker if
// need be, with no name above them.
export function declutter(
  state: NetworkMapState,
  lines: DrawnLine[],
  layout: SiteLayout,
  pinned: ReadonlySet<number> = new Set(),
) {
  const placer = makePlacer(reservedAreas(state.size.h));
  const sites = state.data.sites?.features ?? [];
  const markerPoints = [...layout.sites.map((site) => site.point), ...layout.badges.map((badge) => badge.crowd.center)];
  for (const [x, y] of markerPoints) {
    placer.block([x - SITE_HALF, y - SITE_HALF, x + SITE_HALF, y + SITE_HALF]);
  }
  for (const site of layout.sites.filter((placed) => placed.spread)) {
    const [x, y] = site.point;
    placer.block([x, y - 9, x + SITE_HALF + nameWidth(sites[site.index].properties.name), y + 9]);
  }
  const chipShown = new Set<number>();
  const placeChip = (line: DrawnLine) => {
    const isPinned = pinned.has(line.segment.segment_id);
    const [x, y, width, height] = chipBox(line, !isPinned);
    if (isPinned) {
      placer.block([x - width / 2, y - height / 2, x + width / 2, y + height / 2]);
      chipShown.add(line.segment.segment_id);
    } else if (placer.fits(x, y, width, height)) {
      chipShown.add(line.segment.segment_id);
    }
  };
  const shown = lines.filter((line) => line.show);
  shown.filter((line) => line.selected).forEach(placeChip);
  shown.filter((line) => !line.selected).forEach(placeChip);
  const nameShown = new Set<number>();
  const zoomedOut = (state.camera?.zoom ?? 0) < NAME_ZOOM;
  for (const site of layout.sites.filter((placed) => !placed.spread)) {
    const [x, y] = site.point;
    if (site.end) {
      nameShown.add(site.index);
      continue;
    }
    if (zoomedOut) {
      continue;
    }
    const fits = placer.fits(x, y + NAME_BELOW, nameWidth(sites[site.index].properties.name), 18);
    if (fits) {
      nameShown.add(site.index);
    }
  }
  return { chipShown, nameShown };
}

export function linePath(points: Point[]): string {
  return "M" + points.map((point) => `${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join("L");
}
