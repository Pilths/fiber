import { useState } from "react";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { STATUS, type CoreStatus } from "@/lib/status";

type Detail = components["schemas"]["SpanDetail"];
type Filter = "All" | Exclude<CoreStatus, "Available"> | "Count only";
const DOT: Record<string, string> = { Reserved: "text-[#272a30]", Requested: "text-amber", "In use": "text-[#50555d]", Faulty: "text-red", "Count only": "text-[#50555d]" };

// One row per held core from GET /api/spans/{id}, plus one count-only row. Age and the reservation's planner
// are not on the span endpoint (history is TASK-077), so those columns are left out.
export function HeldTable({ d, onOpen }: { d: Detail; onOpen: (c: Detail["cores"][number]) => void }) {
  const [filter, setFilter] = useState<Filter>("All");
  const held = d.cores.filter((c) => c.status !== "Available");
  const count = (f: Filter) => (f === "All" ? held.length + (d.unassigned_reserved ? 1 : 0) : f === "Count only" ? (d.unassigned_reserved ? 1 : 0) : held.filter((c) => c.status === f).length);
  const filters = (["All", "Reserved", "Requested", "In use", "Faulty", "Count only"] as Filter[]).filter((f) => f === "All" || count(f) > 0);
  const rows = held.filter((c) => filter === "All" || c.status === filter);
  const showCount = d.unassigned_reserved > 0 && (filter === "All" || filter === "Count only");
  const withCores = held.filter((c) => c.status !== "Faulty").length;
  const faulty = held.length - withCores;

  return (
    <section className="card" aria-labelledby="held-h">
      <div className="card-h">
        <h2 id="held-h">Held on this span</h2>
        <small className="hint">{withCores} cores held with numbers, {d.unassigned_reserved} held without, {faulty} faulty</small>
      </div>
      {held.length === 0 && !d.unassigned_reserved ? <p className="text-[13px] text-muted-foreground">Nothing is held on this span.</p> : (
        <>
          <div role="group" aria-label="Filter held cores by status" className="mb-2 flex flex-wrap gap-2">
            {filters.map((f) => (
              <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f !== "All" && <span className={`dot ${filter === f ? "" : DOT[f]}`} />}{f} <b>{count(f)}</b>
              </button>
            ))}
          </div>
          <table className="tbl table-fixed">
            <caption className="sr-only">Held cores on this span</caption>
            <thead><tr>
              <th scope="col" className="w-[13%]">Cores</th><th scope="col" className="w-[13%]">Status</th><th scope="col" className="w-[17%]">Held by</th>
              <th scope="col">Ports or detail</th><th scope="col" className="w-[15%]">Circuit</th><th scope="col" className="w-[12%] pr-0! text-right!">Planned</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} onClick={() => onOpen(c)} className={`cursor-pointer hover:bg-raised ${c.status === "Faulty" ? "bg-red-bg" : c.status === "Requested" ? "bg-amber-bg" : ""}`}>
                  <th scope="row" className={`text-left font-semibold text-foreground ${c.status === "Faulty" ? "pl-3 shadow-[inset_3px_0_0_var(--red)]" : ""}`}>
                    <button type="button" className="text-blue underline underline-offset-2 hover:no-underline" aria-label={`Core ${c.number} details`} onClick={(e) => { e.stopPropagation(); onOpen(c); }}>{c.number}</button>
                  </th>
                  <td><span className={`inline-flex items-center gap-2 font-semibold whitespace-nowrap ${STATUS[c.status].tone}`}><Icon name={STATUS[c.status].icon} />{c.status}</span>
                    {c.stale && <>{" "}<span className="pill h-amber mt-1" title={`No keep for over 3 months since ${c.stale_since ?? "-"}`}><Icon name="lo" />Stale<span className="sr-only">: no keep for over 3 months since {c.stale_since ?? "-"}</span></span></>}</td>
                  <td className="truncate">{c.customer ?? "-"}</td>
                  <td className="py-2 leading-snug">{c.status === "Faulty" ? "Not bookable" : c.port_a || c.port_b ? `${c.port_a ?? "-"} to ${c.port_b ?? "-"}` : "-"}</td>
                  <td className="truncate font-mono text-[13px]">{c.circuit_id ?? "-"}</td>
                  <td className="pr-0 text-right">{c.planned_date ?? "-"}</td>
                </tr>
              ))}
              {showCount && (
                <tr>
                  <th scope="row" className="text-left font-semibold">{d.unassigned_reserved}, not assigned</th>
                  <td><span className="inline-flex items-center gap-2 font-semibold whitespace-nowrap text-[#50555d]"><Icon name="co" />Count only</span></td>
                  <td>-</td>
                  <td className="py-2 leading-snug">Reserved by count, no cell; an admin assigns cores later</td>
                  <td>-</td>
                  <td className="pr-0 text-right">-</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
