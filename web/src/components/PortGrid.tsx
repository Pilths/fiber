import { useEffect, useRef, useState } from "react";
import type { components } from "@/api/schema";
import { STATUS, STATUS_ORDER } from "@/lib/status";

type Core = components["schemas"]["CoreDetail"];
const COLS = 12; // one fibre tube per row

export function PortGrid({ cores, selected, onToggle, focusCoreId }: {
  cores: Core[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  focusCoreId: number | null;
}) {
  const [idx, setIdx] = useState(0); // roving tabindex position
  const [caption, setCaption] = useState<Core | null>(null);
  const cells = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const i = cores.findIndex((c) => c.id === focusCoreId);
    if (i >= 0) {
      setIdx(i);
      cells.current[i]?.focus();
      cells.current[i]?.scrollIntoView({ block: "nearest" });
    }
  }, [focusCoreId, cores]);

  const move = (i: number) => {
    const n = Math.max(0, Math.min(cores.length - 1, i));
    setIdx(n);
    cells.current[n]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number, c: Core) => {
    const d: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS };
    if (e.key in d) { e.preventDefault(); move(i + d[e.key]); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(cores.length - 1); }
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (c.status === "Available") onToggle(c.id); }
  };
  const label = (c: Core) => `Core ${c.number}: ${c.status}${c.customer ? `, ${c.customer}` : ""}`;
  const rows = Array.from({ length: Math.ceil(cores.length / COLS) }, (_, r) => cores.slice(r * COLS, r * COLS + COLS));

  return (
    <div>
      <ul aria-label="Status key" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {STATUS_ORDER.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span aria-hidden className={`core ${STATUS[s].cls} inline-block size-5 rounded text-center text-xs leading-4`}>{STATUS[s].symbol}</span>
            {s}
          </li>
        ))}
      </ul>
      <div role="grid" aria-label="Cores" aria-multiselectable="true" className="flex max-w-full flex-col gap-1 overflow-x-auto">
        {rows.map((row, r) => (
          <div role="row" key={r} aria-label={`Tube ${r + 1}`} className="flex gap-1">
            {row.map((c, j) => {
              const i = r * COLS + j;
              const avail = c.status === "Available";
              return (
                <div
                  key={c.id}
                  ref={(el) => { cells.current[i] = el; }}
                  role="gridcell"
                  tabIndex={i === idx ? 0 : -1}
                  aria-label={label(c)}
                  aria-selected={selected.has(c.id)}
                  aria-disabled={!avail}
                  title={label(c)}
                  data-status={c.status}
                  className={`core ${STATUS[c.status].cls} flex h-12 w-16 shrink-0 cursor-pointer select-none flex-col items-center justify-center rounded-md text-[11px] leading-tight`}
                  onClick={() => { setIdx(i); if (avail) onToggle(c.id); }}
                  onFocus={() => { setIdx(i); setCaption(c); }}
                  onMouseEnter={() => setCaption(c)}
                  onMouseLeave={() => setCaption(null)}
                  onKeyDown={(e) => onKey(e, i, c)}
                >
                  <span className="text-xs font-semibold">
                    <span aria-hidden>{selected.has(c.id) ? "✓" : STATUS[c.status].symbol}</span> {c.number}
                  </span>
                  <span>{c.status}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 min-h-5 text-sm" data-testid="grid-caption">
        {caption
          ? `${label(caption)}${caption.circuit_id ? `, circuit ${caption.circuit_id}` : ""}${caption.status !== "Available" ? " (not selectable)" : ""}`
          : "Hover or focus a core for details. Space or Enter selects an Available core."}
      </p>
    </div>
  );
}
