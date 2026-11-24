import type { PlacedSite, SiteBadge, SiteLayout, SiteSpread } from "@/lib/siteLayout";
import type { Point } from "@/lib/mapGeometry";
import { plural } from "@/lib/format";
import { siteLook, type SiteFeature } from "@/lib/mapLayers";
import type { NetworkMapState } from "@/lib/useNetworkMap";

// Site markers on the map, the count badges of crowded sites and the spread lists with their leader lines.

type SiteMarkerProps = {
  site: PlacedSite;
  feature: SiteFeature;
  segmentCount: number;
  named: boolean;
};

function markerClass(site: PlacedSite): string {
  const classes = ["msite"];
  if (site.end) {
    classes.push("end");
  }
  if (site.spread) {
    classes.push("spread");
  }
  return classes.join(" ");
}

// A marker is a picture with a spoken label, not a control: the map defines no action for a site click.
function SiteMarker({ site, feature, segmentCount, named }: SiteMarkerProps) {
  const { site_id, name, kind } = feature.properties;
  const look = siteLook(kind);
  const endNote = site.end ? ", end of the selection" : "";
  const label = `Site ${name}, ${look.word}, ${plural(segmentCount, "segment")}${endNote}`;
  const style = { left: site.point[0], top: site.point[1] };
  return (
    <span role="img" data-testid="map-site" data-site-id={site_id} data-end={site.end}
      aria-label={label} className={markerClass(site)} style={style}>
      <span className={`shape ${look.shape}`} />
      {(named || site.spread) && <span className="code" aria-hidden="true">{name}</span>}
    </span>
  );
}

type CrowdBadgeProps = { badge: SiteBadge; names: string[]; onZoom: (point: Point) => void };

function CrowdBadge({ badge, names, onZoom }: CrowdBadgeProps) {
  const [x, y] = badge.crowd.center;
  const count = badge.crowd.members.length;
  return (
    <button type="button" data-testid="map-badge" className="mbadge"
      aria-label={`${count} sites: ${names.join(", ")}`}
      style={{ left: x, top: y }} onClick={() => onZoom(badge.crowd.center)}>
      {count}
    </button>
  );
}

// Leader lines from the crowd's spot to each row of its spread list.
function LeaderLines({ spreads }: { spreads: SiteSpread[] }) {
  if (spreads.length === 0) {
    return null;
  }
  return (
    <svg data-testid="leader-lines" className="pointer-events-none absolute inset-0 z-[4] size-full" aria-hidden="true">
      {spreads.map(({ center, rows }) => (
        <g key={rows.map((row) => row.index).join(",")} stroke="var(--use)" strokeWidth={1}>
          {rows.map((row) => (
            <line key={row.index} x1={center[0]} y1={center[1]} x2={row.point[0] - 6} y2={row.point[1]} />
          ))}
          <circle cx={center[0]} cy={center[1]} r={2.5} fill="var(--use)" stroke="none" />
        </g>
      ))}
    </svg>
  );
}

type SiteMarkersProps = {
  state: NetworkMapState;
  layout: SiteLayout;
  nameShown: Set<number>;
};

export function SiteMarkers({ state, layout, nameShown }: SiteMarkersProps) {
  const features = state.data.sites?.features ?? [];
  const segmentCount = (siteId: number) => state.features.filter((feature) => {
    if (feature.properties.extra_line) {
      return false;
    }
    return feature.properties.site_a_id === siteId || feature.properties.site_b_id === siteId;
  }).length;
  const namesOf = (badge: SiteBadge) => badge.crowd.members.map((member) => features[member.index].properties.name);
  return (
    <>
      <LeaderLines spreads={layout.spreads} />
      {layout.sites.map((site) => (
        <SiteMarker key={features[site.index].properties.site_id} site={site} feature={features[site.index]}
          segmentCount={segmentCount(features[site.index].properties.site_id)}
          named={nameShown.has(site.index)} />
      ))}
      {layout.badges.map((badge) => (
        <CrowdBadge key={badge.crowd.members.map((member) => member.index).join(",")} badge={badge}
          names={namesOf(badge)} onZoom={state.zoomAt} />
      ))}
    </>
  );
}
