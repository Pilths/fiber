import { projector } from "@/lib/mapProjector";
import type { SitePoint } from "@/lib/useKmzImport";

const WIDTH = 360;
const HEIGHT = 300;
const PAD = 40;

export type MapLine = { key: string; coords: number[][] };

function pathOf(coords: number[][], project: (point: number[]) => number[]): string {
  return `M${coords.map((point) => project(point).map((value) => value.toFixed(1)).join(" ")).join(" L")}`;
}

function Key({ label, dash, dot }: { label: string; dash?: string; dot?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="28" height="10" aria-hidden="true">
        {dot && <circle cx="14" cy="5" r="4" fill="var(--ink)" />}
        {!dot && (
          <line x1="0" y1="5" x2="28" y2="5" stroke={dash ? "var(--blue)" : "var(--ink)"} strokeWidth="2" strokeDasharray={dash} />
        )}
      </svg>
      {label}
    </span>
  );
}

// The segment's two sites, its stored routes (solid ink) and the ticked new lines (dashed blue).
export function RouteMap({ sites, stored, fresh }: { sites: SitePoint[]; stored: number[][][]; fresh: MapLine[] }) {
  const points = [...sites.map((site) => site.lonLat), ...stored.flat(), ...fresh.flatMap((line) => line.coords)];
  if (points.length === 0) {
    return null;
  }
  const project = projector(points, WIDTH, HEIGHT, PAD);
  return (
    <div className="grid content-start gap-2">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} className="rounded-md border bg-subtle"
        role="img" aria-label="Route map" data-testid="route-map">
        {stored.map((coords, index) => (
          <path key={`stored-${index}`} d={pathOf(coords, project)} fill="none" stroke="var(--ink)" strokeWidth="2"
            data-style="stored" />
        ))}
        {fresh.map((line) => (
          <path key={line.key} d={pathOf(line.coords, project)} fill="none" stroke="var(--blue)" strokeWidth="2"
            strokeDasharray="6 4" data-style="new" />
        ))}
        {sites.map((site) => {
          const [x, y] = project(site.lonLat);
          let anchor: "start" | "end" = "start";
          if (x > WIDTH / 2) {
            anchor = "end";
          }
          return (
            <g key={site.name}>
              <circle cx={x} cy={y} r="6" fill="var(--ink)" stroke="#fff" strokeWidth="2" />
              <text x={x} y={y + 22} textAnchor={anchor} fontSize="12" fill="var(--ink)" paintOrder="stroke"
                stroke="#fff" strokeWidth="3">{site.name}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 text-body">
        <Key label="Stored" />
        <Key label="New" dash="6 4" />
        <Key label="Site" dot />
      </div>
    </div>
  );
}
