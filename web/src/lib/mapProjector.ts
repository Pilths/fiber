// Equirectangular fit of lon/lat into the box, longitude scaled by the cosine of the middle latitude.
export function projector(points: number[][], width: number, height: number, pad: number) {
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const middleLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const squash = Math.cos((middleLat * Math.PI) / 180);
  const minX = Math.min(...lons) * squash;
  const maxX = Math.max(...lons) * squash;
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const scale = Math.min((width - 2 * pad) / Math.max(maxX - minX, 1e-6), (height - 2 * pad) / Math.max(maxLat - minLat, 1e-6));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxLat - minLat) * scale) / 2;
  return (point: number[]) => [offsetX + (point[0] * squash - minX) * scale, offsetY + (maxLat - point[1]) * scale];
}
