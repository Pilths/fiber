import { useEffect, useRef, useState } from "react";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { STATUS } from "@/lib/status";

type Core = components["schemas"]["CoreDetail"];
const COLS = 12; // one fibre tube per row

export function PortGrid({ cores, selected, onToggle, onOpen, focusCoreId }: {
  cores: Core[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  onOpen: (c: Core) => void; // core detail; Available cores open it from the "Core N details" button
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
      cells.current[i]?.scrollIntoView({ block: "center" });
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
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (c.status === "Available") onToggle(c.id); else onOpen(c); }
  };
  const label = (c: Core) => `Core ${c.number}: ${selected.has(c.id) ? "Chosen" : c.status}${c.customer ? `, ${c.customer}` : ""}`;
  const rows = Array.from({ length: Math.ceil(cores.length / COLS) }, (_, r) => cores.slice(r * COLS, r * COLS + COLS));

  return (
    <div>
      <div role="grid" aria-label="Cores" aria-multiselectable="true">
        {rows.map((row, r) => {
          const free = row.filter((c) => c.status === "Available").length;
          const tube = `Tube ${r + 1}, cores ${row[0].number} to ${row[row.length - 1].number}`;
          return (
            <div key={r} className="border-b border-rule pt-3.5 pb-4">
              <p aria-hidden className="mb-2 text-body text-muted-foreground">{tube}, <b className="font-semibold text-foreground">{free} available</b></p>
              <div role="row" aria-label={`${tube}, ${free} available`} className="grid grid-cols-12 gap-1">
                {row.map((c, j) => {
                  const i = r * COLS + j;
                  const avail = c.status === "Available";
                  const chosen = selected.has(c.id);
                  return (
                    <div
                      key={c.id}
                      ref={(el) => { cells.current[i] = el; }}
                      role="gridcell"
                      tabIndex={i === idx ? 0 : -1}
                      aria-label={label(c)}
                      aria-selected={chosen}
                      aria-disabled={!avail}
                      title={label(c)}
                      data-status={c.status}
                      className={`core ${STATUS[c.status].cls}`}
                      onClick={() => { setIdx(i); if (avail) onToggle(c.id); else onOpen(c); }}
                      onFocus={() => { setIdx(i); setCaption(c); }}
                      onMouseEnter={() => setCaption(c)}
                      onMouseLeave={() => setCaption(null)}
                      onKeyDown={(e) => onKey(e, i, c)}
                    >
                      <span className="n">{c.number}</span>
                      <Icon name={chosen ? "ch" : STATUS[c.status].icon} />
                      <span className="w">{chosen ? "Chosen" : c.status}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <p className="min-h-5 flex-1 text-body text-muted-foreground" data-testid="grid-caption">
          {caption
            ? `${label(caption)}${caption.circuit_id ? `, circuit ${caption.circuit_id}` : ""}${caption.status !== "Available" ? " (not selectable; click or Enter for its detail)" : ""}`
            : "Hover or focus a core for details. Space or Enter chooses an Available core, or opens the detail of an allocated one."}
        </p>
        {cores[idx] && <button type="button" className="btn btn-sm flex-none" onClick={() => onOpen(cores[idx])}>Core {cores[idx].number} details</button>}
      </div>
    </div>
  );
}
