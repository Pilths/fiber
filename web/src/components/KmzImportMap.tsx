import { projector } from "@/lib/mapProjector";
import type { Group, KmzImport } from "@/lib/useKmzImport";

const WIDTH = 640;
const HEIGHT = 440;
const PAD = 48;

type Stroke = { colour: string; dash: string | undefined; width: number };
const STROKE: Record<Group, Stroke> = {
  ready: { colour: "var(--blue)", dash: undefined, width: 3 },
  check: { colour: "var(--amber)", dash: "9 6", width: 3 },
  skipped: { colour: "var(--muted-ink)", dash: "2 5", width: 2.5 },
};
const HOVER: Stroke = { colour: "var(--blue)", dash: undefined, width: 7 };
const LEGEND: { group: Group; label: string }[] = [
  { group: "ready", label: "Ready" },
  { group: "check", label: "To check" },
  { group: "skipped", label: "Skipped" },
];

function LegendLine({ group, label }: { group: Group; label: string }) {
  const stroke = STROKE[group];
  return (
    <span className="flex items-center gap-2">
      <svg width="32" height="8" aria-hidden="true">
        <line x1="1" y1="4" x2="31" y2="4" stroke={stroke.colour} strokeWidth={stroke.width}
          strokeDasharray={stroke.dash} strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

// Ready lines solid blue, To check dashed amber, Skipped dotted grey; the hovered row's line is thick blue.
export function KmzImportMap({ state, hovered }: { state: KmzImport; hovered: string | null }) {
  const { lines, segments, sites } = state;
  const siteIds = new Set<number>();
  for (const line of lines) {
    const segmentId = state.segmentOf(line);
    for (const siteId of segments.get(segmentId ?? -1)?.siteIds ?? []) {
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
  const project = projector(allPoints, WIDTH, HEIGHT, PAD);
  // Skipped first so Ready draws on top, the hovered line last of all.
  const order: Group[] = ["skipped", "check", "ready"];
  const rank = (key: string, group: Group) => {
    if (key === hovered) {
      return order.length;
    }
    return order.indexOf(group);
  };
  const sorted = [...lines].sort((first, second) =>
    rank(first.key, state.groupOf(first)) - rank(second.key, state.groupOf(second)));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="min-h-0 w-full flex-1 rounded-md border bg-subtle"
        role="img" aria-label="Map preview of the lines" data-testid="kmz-import-map">
        {sorted.map((line) => {
          const group = state.groupOf(line);
          let stroke = STROKE[group];
          if (line.key === hovered) {
            stroke = HOVER;
          }
          const path = line.coords.map((point) => project(point).map((value) => value.toFixed(1)).join(" ")).join(" L");
          return (
            <path key={line.key} d={`M${path}`} fill="none" stroke={stroke.colour} strokeWidth={stroke.width}
              strokeDasharray={stroke.dash} strokeLinecap="round" strokeLinejoin="round" data-style={group}
              data-hover={line.key === hovered ? "true" : undefined} />
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
              <text x={textX} y={y - 9} textAnchor={anchor} fontSize="13" fill="var(--ink)" paintOrder="stroke"
                stroke="#fff" strokeWidth="3">{site.name}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-6 text-body">
        {LEGEND.map((item) => <LegendLine key={item.group} group={item.group} label={item.label} />)}
      </div>
    </div>
  );
}
