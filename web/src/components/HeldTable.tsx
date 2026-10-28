import { useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { Dialog } from "@/components/upload-parts";
import { spanName, STATUS, statusLabel, type CoreStatus } from "@/lib/status";

type Detail = components["schemas"]["SpanDetail"];
type Hold = components["schemas"]["UnassignedHold"];
type Filter = "All" | Exclude<CoreStatus, "Available"> | "Unassigned";

// One row per held core from GET /api/spans/{id}, plus one count-only row per reservation with unassigned cores.
// Age and the reservation's planner are not on the span endpoint (history is TASK-077), so those columns are left out.
export function HeldTable({ d, admin, onOpen, onChanged }: { d: Detail; admin: boolean; onOpen: (c: Detail["cores"][number]) => void; onChanged: () => void }) {
  const [filter, setFilter] = useState<Filter>("All");
  const [assign, setAssign] = useState<Hold | null>(null);
  const held = d.cores.filter((c) => c.status !== "Available");
  const count = (f: Filter) => (f === "All" ? held.length + d.unassigned.length : f === "Unassigned" ? d.unassigned.length : held.filter((c) => c.status === f).length);
  const filters = (["All", "Reserved", "Requested", "In use", "Faulty", "Unassigned"] as Filter[]).filter((f) => f === "All" || count(f) > 0);
  const rows = held.filter((c) => filter === "All" || c.status === filter);
  const holds = filter === "All" || filter === "Unassigned" ? d.unassigned : [];

  return (
    <section className="card" aria-labelledby="held-h">
      <div className="card-h">
        <h2 id="held-h" tabIndex={-1} className="outline-offset-4">Allocations<span className="font-normal text-muted-foreground"> of {spanName(d)}</span></h2>
      </div>
      {held.length === 0 && !d.unassigned.length ? <p className="text-body text-muted-foreground">No allocations.</p> : (
        <>
          <div role="group" aria-label="Filter allocations by status" className="mb-2 flex flex-wrap gap-2">
            {filters.map((f) => (
              <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f !== "All" && <Icon name={f === "Unassigned" ? "co" : STATUS[f].icon} className={`ic ${filter === f ? "" : f === "Unassigned" ? "text-use" : STATUS[f].tone}`} />}{statusLabel(f)} <b>{count(f)}</b>
              </button>
            ))}
          </div>
          <table className="tbl table-fixed [&_td]:text-center! [&_th]:text-center!">
            <caption className="sr-only">Allocations on this span</caption>
            <thead><tr>
              <th scope="col" className="w-[9%]">Cores</th><th scope="col" className="w-[14%]">Status</th><th scope="col" className="w-[17%]">Customer</th>
              <th scope="col">Ports or detail</th><th scope="col" className="w-[14%]">Circuit</th><th scope="col" className="w-[15%] pr-0!">Planned date</th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} onClick={() => onOpen(c)} className={`cursor-pointer hover:bg-raised ${c.status === "Faulty" ? "bg-red-bg" : c.status === "Requested" ? "bg-amber-bg" : ""}`}>
                  <th scope="row" className={`text-left font-semibold text-foreground ${c.status === "Faulty" ? "pl-3 shadow-[inset_3px_0_0_var(--red)]" : ""}`}>
                    <button type="button" className="link" aria-label={`Core ${c.number} details`} onClick={(e) => { e.stopPropagation(); onOpen(c); }}>{c.number}</button>
                  </th>
                  <td><span className={`inline-flex items-center gap-2 font-semibold whitespace-nowrap ${STATUS[c.status].tone}`}><Icon name={STATUS[c.status].icon} />{c.status}</span>
                    {c.stale && <>{" "}<span className="pill h-amber mt-1" title={`No keep for over 3 months since ${c.stale_since ?? "-"}`}><Icon name="lo" />Stale<span className="sr-only">: no keep for over 3 months since {c.stale_since ?? "-"}</span></span></>}</td>
                  <td className="truncate">{c.customer ?? "-"}</td>
                  <td className="py-2 leading-snug">{c.status === "Faulty" ? "Not bookable" : c.port_a || c.port_b ? `${c.port_a ?? "-"} to ${c.port_b ?? "-"}` : "-"}</td>
                  <td className="truncate font-mono text-body">{c.circuit_id ?? "-"}</td>
                  <td className="pr-0 whitespace-nowrap">{c.planned_date ?? "-"}</td>
                </tr>
              ))}
              {holds.map((h) => (
                <tr key={`u${h.reservation_id}`} data-testid="unassigned-row">
                  <th scope="row" className="text-left font-semibold">{h.remaining}</th>
                  <td><span className="inline-flex items-center gap-2 font-semibold whitespace-nowrap text-use"><Icon name="co" />Unassigned</span></td>
                  <td className="truncate" title={h.customer ?? undefined}>{h.customer ?? "-"}</td>
                  <td className="py-2 leading-snug">{admin ? <button type="button" className="btn btn-sm" onClick={() => setAssign(h)}>Assign cores</button> : "-"}</td>
                  <td>-</td>
                  <td className="pr-0 whitespace-nowrap">{h.planned_date ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {assign && <AssignDialog d={d} hold={assign} onClose={() => setAssign(null)} onSaved={onChanged} />}
    </section>
  );
}

// Admin names specific Available cores for part or all of a count-only reservation (an 'assigned' event).
function AssignDialog({ d, hold, onClose, onSaved }: { d: Detail; hold: Hold; onClose: () => void; onSaved: () => void }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const free = d.cores.filter((c) => c.status === "Available");
  const full = picked.size >= hold.remaining;
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/reservations/{rid}/assign", { path: { rid: hold.reservation_id }, body: { cores: [...picked] } });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not assign. Try again."));
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Assign cores to ${hold.customer ?? `reservation #${hold.reservation_id}`}`} onClose={onClose} wide>
      <p className="mt-2 text-body text-muted-foreground">Reservation #{hold.reservation_id}, {hold.remaining} unassigned. Choose up to {hold.remaining}. <b className="font-semibold text-foreground">{picked.size} chosen</b>.</p>
      {error && <p role="alert" className="mt-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">{error}</p>}
      <form onSubmit={submit} noValidate aria-label="Assign cores">
        {free.length === 0 ? <p className="mt-4 text-body text-muted-foreground">No Available cores on this span.</p> : (
          <div role="group" aria-label="Available cores" className="mt-4 grid max-h-[50vh] grid-cols-12 gap-1 overflow-y-auto">
            {free.map((c) => {
              const on = picked.has(c.id);
              return (
                <button key={c.id} type="button" aria-pressed={on} aria-label={`Core ${c.number}`} disabled={!on && full} onClick={() => toggle(c.id)}
                  className={`flex h-9 items-center justify-center gap-0.5 rounded-md border text-sm font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:cursor-not-allowed disabled:opacity-40 ${on ? "border-[#0f3a78] bg-blue text-white" : "border-line bg-white hover:border-foreground"}`}>
                  {on && <Icon name="ch" />}{c.number}
                </button>
              );
            })}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-p" disabled={busy || !picked.size}>{busy ? "Assigning…" : picked.size ? `Assign ${picked.size} ${picked.size === 1 ? "core" : "cores"}` : "Assign cores"}</button>
        </div>
      </form>
    </Dialog>
  );
}
