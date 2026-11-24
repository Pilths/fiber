import type { KmzImport } from "@/lib/useKmzImport";

const WIDTH = 640;
const HEIGHT = 440;
const PAD = 48;

type Style = "picked" | "suggested" | "left";
const STROKE: Record<Style, { colour: string; dash: string | undefined; width: number }> = {
  picked: { colour: "var(--blue)", dash: undefined, width: 3 },
  suggested: { colour: "var(--blue)", dash: "9 6", width: 3 },
  left: { colour: "var(--muted-ink)", dash: "2 5", width: 2 },
};

// Equirectangular fit of lon/lat into the box, longitude scaled by the cosine of the middle latitude.
function projector(points: number[][]) {
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const middleLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const squash = Math.cos((middleLat * Math.PI) / 180);
  const minX = Math.min(...lons) * squash;
  const maxX = Math.max(...lons) * squash;
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const scale = Math.min((WIDTH - 2 * PAD) / Math.max(maxX - minX, 1e-6), (HEIGHT - 2 * PAD) / Math.max(maxLat - minLat, 1e-6));
  const offsetX = (WIDTH - (maxX - minX) * scale) / 2;
  const offsetY = (HEIGHT - (maxLat - minLat) * scale) / 2;
  return (point: number[]) => [offsetX + (point[0] * squash - minX) * scale, offsetY + (maxLat - point[1]) * scale];
}

function LegendLine({ style, label }: { style: Style; label: string }) {
  const stroke = STROKE[style];
  return (
    <span className="flex items-center gap-2">
      <svg width="32" height="8" aria-hidden="true">
        <line x1="0" y1="4" x2="32" y2="4" stroke={stroke.colour} strokeWidth={stroke.width} strokeDasharray={stroke.dash} />
      </svg>
      {label}
    </span>
  );
}

// Picked lines solid, suggested dashed, left out (unticked or not matched) dotted grey; site dots of the segments.
export function KmzImportMap({ state }: { state: KmzImport }) {
  const { lines, assigned, ticked, segments, sites, segmentOrder } = state;
  const styleOf = (key: string): Style => {
    const assignment = assigned[key];
    if (assignment == null || !ticked.has(key)) {
      return "left";
    }
    if (assignment.source === "suggested") {
      return "suggested";
    }
    return "picked";
  };
  const siteIds = new Set<number>();
  for (const segmentId of segmentOrder) {
    for (const siteId of segments.get(segmentId)?.siteIds ?? []) {
      siteIds.add(siteId);
    }
  }
  const shownSites = [...siteIds].flatMap((siteId) => {
    const site = sites.get(siteId);
    if (site == null) {
      return [];
    }
    return [{ id: siteId, ...site }];
  });
  const allPoints = [...lines.flatMap((line) => line.coords), ...shownSites.map((site) => site.lonLat)];
  if (allPoints.length === 0) {
    return <p className="text-body text-muted-foreground">No lines</p>;
  }
  const project = projector(allPoints);
  // Left-out lines first so the picked ones draw on top.
  const order: Style[] = ["left", "suggested", "picked"];
  const sorted = [...lines].sort((first, second) => order.indexOf(styleOf(first.key)) - order.indexOf(styleOf(second.key)));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="min-h-0 w-full flex-1 rounded-md border bg-subtle"
        role="img" aria-label="Map preview of the lines" data-testid="kmz-import-map">
        {sorted.map((line) => {
          const stroke = STROKE[styleOf(line.key)];
          const path = line.coords.map((point) => project(point).map((value) => value.toFixed(1)).join(" ")).join(" L");
          return (
            <path key={line.key} d={`M${path}`} fill="none" stroke={stroke.colour} strokeWidth={stroke.width}
              strokeDasharray={stroke.dash} strokeLinecap="round" strokeLinejoin="round" data-style={styleOf(line.key)} />
          );
        })}
        {shownSites.map((site) => {
          const [x, y] = project(site.lonLat);
          // Names on the right half sit left of their dot so they stay inside the box.
          let anchor: "start" | "end" = "start";
          let textX = x + 9;
          if (x > WIDTH / 2) {
            anchor = "end";
            textX = x - 9;
          }
          return (
            <g key={site.id}>
              <circle cx={x} cy={y} r="6" fill="var(--ink)" stroke="#fff" strokeWidth="2" />
              <text x={textX} y={y - 9} textAnchor={anchor} fontSize="13" fontWeight="600" fill="var(--ink)" paintOrder="stroke"
                stroke="#fff" strokeWidth="3">{site.name}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-6 text-body">
        <LegendLine style="picked" label="Picked" />
        <LegendLine style="suggested" label="Suggested" />
        <LegendLine style="left" label="Left out" />
      </div>
    </div>
  );
}
