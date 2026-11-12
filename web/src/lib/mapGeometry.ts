// Web Mercator at 512 px tiles, the same as MapLibre, so the overlay lines up with the basemap.

export type Camera = { lng: number; lat: number; zoom: number };
export type Bounds = [number, number, number, number]; // west, south, east, north
export type Point = [number, number];
export type Size = { w: number; h: number };

export const MALAYSIA: Bounds = [99.5, 0.8, 119.5, 7.5];
export const TILE = 512;
const MIN_ZOOM = 4;
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

export function fitView([west, south, east, north]: Bounds, width: number, height: number, pad = 60): Camera {
  const spanX = Math.max(mercatorX(east) - mercatorX(west), 1e-4);
  const spanY = Math.max(mercatorY(south) - mercatorY(north), 1e-4);
  const scaleX = (width - 2 * pad) / (spanX * TILE);
  const scaleY = (height - 2 * pad) / (spanY * TILE);
  const zoom = Math.min(MAX_FIT_ZOOM, Math.max(MIN_ZOOM, Math.log2(Math.min(scaleX, scaleY))));
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
