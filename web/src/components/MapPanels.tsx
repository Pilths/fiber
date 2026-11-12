import type { ReactNode } from "react";
import { KEY_LABEL, plural, ROUTE_LAYERS, SITE_LAYERS, trunkRoutesOf } from "@/lib/mapLayers";
import type { NetworkMapState } from "@/lib/useNetworkMap";

// The network map's toolbar, Layers panel, key and not-drawn list.

const LAYERS_PANEL_CLASS =
  "absolute top-[38px] left-0 w-[270px] rounded-lg border border-line bg-white px-3.5 py-3";

// The Layers panel: Routes (type tick boxes with their key swatch, trunk route chips) and Sites.
function LayersPanel({ state }: { state: NetworkMapState }) {
  const { routeLayers, trunkOff, siteLayers } = state;
  const trunkRoutes = trunkRoutesOf(state.features);
  const toggleTrunk = (route: string) => {
    const next = new Set(trunkOff);
    if (next.has(route)) {
      next.delete(route);
    } else {
      next.add(route);
    }
    state.setTrunkOff(next);
  };
  return (
    <div id="map-layers" hidden={!state.layersOpen} className={LAYERS_PANEL_CLASS}>
      <fieldset>
        <legend className="lbl mb-1.5">Routes</legend>
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
      <fieldset className="mt-2.5">
        <legend className="lbl mb-1.5">Sites</legend>
        {SITE_LAYERS.map(([kind, label, shape]) => (
          <label key={kind} className="lrow">
            <input type="checkbox" checked={siteLayers[kind]}
              onChange={(event) => state.setSiteLayers({ ...siteLayers, [kind]: event.target.checked })} />
            <i className="slot" aria-hidden="true"><i className={shape} /></i>
            {label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export function MapControls({ state, tools }: { state: NetworkMapState; tools?: ReactNode }) {
  const full = state.full;
  const fullIcon = full ? "M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" : "M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4";
  return (
    <div className="absolute top-3 left-3 z-10 flex items-start gap-2">
      <div className="relative">
        <button type="button" className="mbtn" aria-expanded={state.layersOpen} aria-controls="map-layers"
          onClick={() => state.setLayersOpen((open) => !open)}>
          <svg className="ni" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2l6 3.2-6 3.2-6-3.2zM2 8.4l6 3.2 6-3.2M2 11.4l6 3.2 6-3.2" />
          </svg>
          Layers
          <svg className="ni size-3!" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
        </button>
        <LayersPanel state={state} />
      </div>
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

// The key doubles as Layers: click an entry to show or hide it (same state as the Layers panel).
export function MapKey({ state }: { state: NetworkMapState }) {
  const { routeLayers, siteLayers } = state;
  return (
    <div role="group" aria-label="Map key" className="mleg">
      <p className="mleg-h col-span-2">Route type</p>
      {ROUTE_LAYERS.map(([type, swatch]) => (
        <button key={type} type="button" aria-pressed={routeLayers[type]} aria-label={`Show ${type} lines`}
          onClick={() => state.setRouteLayers({ ...routeLayers, [type]: !routeLayers[type] })}>
          <i className="slot" aria-hidden="true"><i className={swatch} /></i>{type}
        </button>
      ))}
      <span><i className="slot" aria-hidden="true"><i className="ll s" /></i>Selected</span>
      <p className="mleg-h col-span-2">Sites</p>
      {SITE_LAYERS.map(([kind, label, shape]) => (
        <button key={kind} type="button" aria-pressed={siteLayers[kind]} aria-label={`Show ${label}`}
          onClick={() => state.setSiteLayers({ ...siteLayers, [kind]: !siteLayers[kind] })}>
          <i className="slot" aria-hidden="true"><i className={shape} /></i>{KEY_LABEL[kind]}
        </button>
      ))}
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
