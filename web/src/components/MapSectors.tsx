import { clusterColour, clusterFade, clustersOf, sectorRings, type SectorFeature } from "@/lib/mapClusters";
import type { SectorLabel } from "@/lib/clusterLayout";
import { project, type Bounds, type Point } from "@/lib/mapGeometry";
import { plural } from "@/lib/mapLayers";
import type { NetworkMapState } from "@/lib/useNetworkMap";

// Cluster outlines under the route lines (a light fill that fades to a thin outline as the zoom passes the fade
// window) and the cluster labels shown while zoomed out. Each cluster has its own tint.

function ringPath(ring: Point[], toScreen: (point: Point) => Point): string {
  const points = ring.map((point) => {
    const [x, y] = toScreen(point);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return `M${points.join("L")}Z`;
}

export function SectorShapes({ state, sectors }: { state: NetworkMapState; sectors: SectorFeature[] }) {
  const { camera, size } = state;
  if (!camera) {
    return null;
  }
  const fade = clusterFade(camera.zoom);
  const toScreen = (point: Point) => project(camera, size, point);
  const clusters = clustersOf(state.data.sectors?.features ?? []);
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true" data-testid="map-sectors">
      {sectors.map((sector) => {
        const colour = clusterColour(clusters, sector.properties.cluster);
        return (
          <path key={sector.properties.cluster} data-testid="map-sector" data-cluster={sector.properties.cluster}
            d={sectorRings(sector).map((ring) => ringPath(ring, toScreen)).join("")}
            fill={colour} fillOpacity={0.18 * (1 - fade)} fillRule="evenodd"
            stroke={colour} strokeWidth={1.5 - 0.5 * fade} strokeOpacity={0.75 - 0.25 * fade}
            strokeLinejoin="round" />
        );
      })}
    </svg>
  );
}

type SectorLabelsProps = { labels: SectorLabel[]; clusters: string[]; onZoom: (bounds: Bounds) => void };

// Cluster label: a small dark count badge ringed in the cluster tint, with the cluster name in small text beside it
// (dropped when it would overlap another cluster label). Its sites are hidden under it.
export function SectorLabels({ labels, clusters, onZoom }: SectorLabelsProps) {
  return labels.map(({ sector, names, point, opacity, active, named }) => {
    const { cluster, site_count, bbox } = sector.properties;
    const colour = clusterColour(clusters, cluster);
    const style = { left: point[0], top: point[1], opacity, "--tint": colour } as React.CSSProperties;
    const spoken = `Cluster ${cluster}, ${plural(site_count, "site")}: ${names.join(", ")}`;
    return (
      <button key={cluster} type="button" data-testid="map-sector-label" data-named={named} className="msector"
        aria-label={spoken} inert={!active} style={style}
        onClick={() => onZoom(bbox)}>
        <span className="msector-n">{site_count}</span>
        {named && <span className="msector-name">{cluster}</span>}
      </button>
    );
  });
}
