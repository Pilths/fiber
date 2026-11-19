import { health } from "@/lib/status";
import { linePath, type DrawnLine } from "@/lib/mapGeometry";
import { chipText, LINE_COLOR, LINE_WIDTH, lineKind } from "@/lib/mapLayers";
import { plural } from "@/lib/format";
import { requestOptionText, type CustomerHighlight } from "@/lib/useCustomerHighlight";

// The network map overlay: segment lines and free-cores chips (site markers: MapSites.tsx).

// Metro: long dash, dot. The round caps add half the 4px width to each end, so the gaps are set wide.
const METRO_DASH = "12 8 2 8";

function lineState(line: DrawnLine): string {
  if (!line.show) {
    return "hidden";
  }
  return line.dim ? "dim" : "";
}

function lineOpacity(line: DrawnLine): number {
  if (!line.show) {
    return 0.12;
  }
  return line.dim ? 0.5 : 1;
}

function MapLine({ line, onSelect }: { line: DrawnLine; onSelect: (id: number) => void }) {
  const { segment, selected } = line;
  const path = linePath(line.points);
  const kind = lineKind(segment.route_type);
  const width = (LINE_WIDTH[kind] ?? 4) + (selected ? 3 : 0);
  const dotted = segment.chip === "not_surveyed" && !selected;
  let dash: string | undefined;
  if (dotted) {
    dash = "1 7";
  } else if (kind === "dc-toc") {
    dash = "9 5";
  } else if (kind === "metro") {
    dash = METRO_DASH;
  }
  const colour = selected ? "var(--blue)" : LINE_COLOR[kind] ?? "var(--line-metro)";
  return (
    <g data-testid="map-line" data-segment-id={segment.segment_id} data-selected={selected}
      data-state={lineState(line)} opacity={lineOpacity(line)}>
      {/* white casing on every line: keeps the dash and double-line patterns readable over the basemap */}
      <path d={path} fill="none" stroke="#fff" strokeWidth={width + (selected ? 4 : 3)}
        strokeLinecap="round" strokeLinejoin="round" />
      <path d={path} fill="none" stroke={colour} strokeWidth={dotted ? 4 : width}
        strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} />
      {/* DC-DC: a double line, the colour with a thin white centre */}
      {kind === "dc-dc" && !dotted && (
        <path d={path} fill="none" stroke="#fff" strokeWidth={selected ? 3 : 2.5}
          strokeLinecap="round" strokeLinejoin="round" />
      )}
      {line.show && (
        <path d={path} data-hit fill="none" stroke="transparent" strokeWidth={18} className="cursor-pointer"
          style={{ pointerEvents: "stroke" }} onClick={() => onSelect(segment.segment_id)} />
      )}
    </g>
  );
}

export function MapLines({ lines, onSelect }: { lines: DrawnLine[]; onSelect: (id: number) => void }) {
  const selectedOnTop = [...lines].sort((a, b) => Number(a.selected) - Number(b.selected));
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true"
      data-testid="map-lines">
      {selectedOnTop.map((line) => (
        <MapLine key={line.segment.segment_id} line={line} onSelect={onSelect} />
      ))}
    </svg>
  );
}

// Customer mode: the chip of one of the customer's segments shows its used cores in a grey pill.
// request: the picked request's name, null when the pills sum all requests.
export type ChipUsage = { customer: string; used: number; request: string | null };

type SegmentChipProps = {
  line: DrawnLine;
  shown: boolean;
  usage: ChipUsage | null;
  onSelect: (id: number) => void;
};

function chipLook(segment: DrawnLine["segment"], usage: ChipUsage | null) {
  if (usage) {
    let label = `Segment ${segment.name}, ${plural(usage.used, "core")} used by ${usage.customer}`;
    if (usage.request) {
      label += `, request ${usage.request}`;
    }
    return { label, cls: "used", text: String(usage.used) };
  }
  const status = health({
    survey_cores: segment.surveyed ? 1 : null,
    free_to_reserve: segment.free_to_reserve,
    fiber_cut: segment.fiber_cut,
  });
  let freeText = "not verified";
  if (segment.surveyed) {
    freeText = `${segment.free_to_reserve} free to reserve, ${status.word}`;
  }
  const label = `Segment ${segment.name}, ${segment.route_type ?? "no route type"}, ${freeText}`;
  return { label, cls: status.cls, text: chipText(segment) };
}

export function SegmentChip({ line, shown, usage, onSelect }: SegmentChipProps) {
  const { segment, selected, mid } = line;
  const look = chipLook(segment, usage);
  const style = {
    left: mid[0],
    top: mid[1],
    visibility: shown ? undefined : ("hidden" as const),
    opacity: line.dim ? 0.6 : undefined,
  };
  return (
    <button type="button" data-testid="map-chip" data-segment-id={segment.segment_id} data-selected={selected}
      aria-pressed={selected} aria-label={look.label} className={`mchip ${look.cls} ${selected ? "on" : ""}`}
      style={style} onClick={() => onSelect(segment.segment_id)}>
      {look.text}
      {selected && !usage && <span className="mname" aria-hidden="true">{segment.name}</span>}
    </button>
  );
}

// Map toolbar in customer mode: the customer's name, a request picker (2 or more requests that use cores) and
// an x that ends customer mode. The chip shrinks to the toolbar's width: the name truncates first, the x never.
type CustomerChipProps = {
  customer: CustomerHighlight;
  onPickRequest: (requestId: number | null) => void;
  onClear: () => void;
};

export function CustomerChip({ customer, onPickRequest, onClear }: CustomerChipProps) {
  return (
    <span className="mbtn min-w-0 cursor-default! pr-1!" data-testid="customer-chip">
      <span className="min-w-8 truncate" title={customer.name}>{customer.name}</span>
      {customer.requests.length > 1 && <RequestPicker customer={customer} onPick={onPickRequest} />}
      <button type="button" className="grid size-6 shrink-0 place-items-center rounded hover:bg-raised"
        aria-label="Clear customer highlight" onClick={onClear}>
        ×
      </button>
    </span>
  );
}

const ALL_REQUESTS = "all";

function RequestPicker({ customer, onPick }: { customer: CustomerHighlight; onPick: (id: number | null) => void }) {
  const value = customer.request ? String(customer.request.reservation_id) : ALL_REQUESTS;
  const onChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const chosen = event.target.value;
    if (chosen === ALL_REQUESTS) {
      onPick(null);
      return;
    }
    onPick(Number(chosen));
  };
  return (
    <select aria-label="Request" data-testid="request-picker" value={value} onChange={onChange}
      className="h-6 max-w-64 min-w-24 cursor-pointer rounded border border-line bg-white px-1 text-[13px] font-normal">
      <option value={ALL_REQUESTS}>All requests</option>
      {customer.requests.map((request) => (
        <option key={request.reservation_id} value={request.reservation_id}>{requestOptionText(request)}</option>
      ))}
    </select>
  );
}
