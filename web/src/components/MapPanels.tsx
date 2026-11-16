import type { ReactNode } from "react";
import { plural, ROUTE_LAYERS, SITE_LAYERS, trunkRoutesOf } from "@/lib/mapLayers";
import type { NetworkMapState } from "@/lib/useNetworkMap";

// The network map's toolbar and not-drawn list, and the map filters shown at the foot of the Site A to B panel.

// Compact on purpose: at 1280x720 the route options above still get room for one row.
const FILTERS_CLASS =
  "mt-auto flex flex-none flex-col gap-1.5 border-t border-border pt-2 [&_.lrow]:min-h-5!";

// The set with `name` added, or removed when it was in already.
function toggled(names: Set<string>, name: string): Set<string> {
  const next = new Set(names);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  return next;
}

// Route types: tick boxes with their line swatch; the Trunk row also has one chip per trunk route.
function RouteLayerRows({ state }: { state: NetworkMapState }) {
  const { routeLayers, trunkOff } = state;
  const trunkRoutes = trunkRoutesOf(state.features);
  const toggleTrunk = (route: string) => {
    state.setTrunkOff(toggled(trunkOff, route));
  };
  return (
    <fieldset>
      <legend className="sr-only">Routes</legend>
      {ROUTE_LAYERS.map(([type, swatch]) => (
        <div key={type} className="flex items-center gap-2">
          <label className="lrow flex-1">
            <input type="checkbox" checked={routeLayers[type]}
              onChange={(event) => {
                state.setRouteLayers({ ...routeLayers, [type]: event.target.checked });
              }} />
            <i className="slot" aria-hidden="true"><i className={swatch} /></i>
            {type}
          </label>
          {type === "Trunk" && trunkRoutes.map((route) => (
            <button key={route} type="button" className="chip h-6! px-2! text-xs"
              aria-pressed={!trunkOff.has(route)} aria-label={`Trunk ${route}`}
              disabled={!routeLayers.Trunk}
              onClick={() => toggleTrunk(route)}>
              {route}
            </button>
          ))}
        </div>
      ))}
    </fieldset>
  );
}

// Site kinds: tick boxes with their marker shape, then the key's Selected line.
function SiteLayerRows({ state }: { state: NetworkMapState }) {
  const siteLayers = state.siteLayers;
  return (
    <fieldset>
      <legend className="sr-only">Sites</legend>
      {SITE_LAYERS.map(([kind, label, shape]) => (
        <label key={kind} className="lrow">
          <input type="checkbox" checked={siteLayers[kind]}
            onChange={(event) => state.setSiteLayers({ ...siteLayers, [kind]: event.target.checked })} />
          <i className="slot" aria-hidden="true"><i className={shape} /></i>
          {label}
        </label>
      ))}
      {/* indented by a tick box and its gap so the swatch lines up with the rows above */}
      <span className="lrow pl-[22px]">
        <i className="slot" aria-hidden="true"><i className="ll s" /></i>Selected
      </span>
    </fieldset>
  );
}

// The map filters (Region, then the layers, which double as the map key), pinned to the panel's foot.
export function MapFilterPanel({ state, region }: { state: NetworkMapState; region: ReactNode }) {
  return (
    <div role="group" aria-label="Map filters" data-testid="map-filters" className={FILTERS_CLASS}>
      {region}
      <div className="grid grid-cols-2 gap-x-3">
        <RouteLayerRows state={state} />
        <SiteLayerRows state={state} />
      </div>
    </div>
  );
}

export function MapControls({ state, tools }: { state: NetworkMapState; tools?: ReactNode }) {
  const full = state.full;
  const fullIcon = full ? "M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" : "M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4";
  // The toolbar spans the map's width so the controls wrap onto a second row instead of running past the right
  // edge; the gaps between them let clicks through to the map.
  return (
    <div className="pointer-events-none absolute top-3 right-3 left-3 z-10 flex flex-wrap items-start gap-2
      *:pointer-events-auto">
      <div className="flex" role="group" aria-label="Zoom">
        <button type="button" className="mbtn w-[34px] justify-center rounded-r-none! px-0! text-base"
          aria-label="Zoom in" onClick={() => state.zoomBy(1)}>+</button>
        <button type="button" className="mbtn -ml-px w-[34px] justify-center rounded-l-none! px-0! text-base"
          aria-label="Zoom out" onClick={() => state.zoomBy(-1)}>&minus;</button>
      </div>
      <button type="button" className="mbtn" onClick={state.fitSelection}>Fit selection</button>
      {document.fullscreenEnabled && (
        <button type="button" className="mbtn" aria-pressed={full} onClick={state.toggleFull}>
          <svg className="ni" viewBox="0 0 16 16" aria-hidden="true"><path d={fullIcon} /></svg>
          {full ? "Exit full screen" : "Full screen"}
        </button>
      )}
      {tools}
    </div>
  );
}

export function NotDrawn({ items }: { items: { name: string; reason: string }[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <details className="mt-2 text-xs text-muted-foreground" data-testid="map-not-drawn">
      <summary className="cursor-pointer">
        {plural(items.length, "segment")} not on the map (no coordinates)
      </summary>
      <ul className="mt-1 list-disc pl-5">
        {items.map((item) => (
          <li key={item.name}><b className="font-semibold text-foreground">{item.name}</b>: {item.reason}</li>
        ))}
      </ul>
    </details>
  );
}
