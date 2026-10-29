import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { Blank, LossPill, Metric } from "@/components/LossCard";
import type { RouteOption } from "@/components/RoutePlanner";
import { db, pct, spanName, STATUS, statusLabel, worstText, type LossDetail } from "@/lib/status";

type Detail = components["schemas"]["SpanDetail"];
type Core = Detail["cores"][number];
type Endpoint = { id: number; name: string };
export type Found = { ids: number[]; km: number };

// Route A to B over the whole network: the best (first) option of GET /api/routes, shown on the map and in the Inspector.
export function RouteSearch({ onFound }: { onFound: (f: Found | null) => void }) {
  const [eps, setEps] = useState<Endpoint[]>([]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => { api.get("/api/routes/endpoints").then((r) => setEps(r as unknown as Endpoint[])).catch(() => setMsg({ text: "Could not load the site list.", ok: false })); }, []);

  const search = async (x = a, y = b) => {
    const site = (t: string) => eps.find((e) => e.name.toLowerCase() === t.trim().toLowerCase());
    const from = site(x), to = site(y);
    const fail = (text: string) => { setMsg({ text, ok: false }); onFound(null); };
    if (!from || !to) return fail("Choose sites from the list");
    if (from.id === to.id) return fail("Choose two different sites");
    try {
      const r = (await api.get("/api/routes", { query: { from: from.id, to: to.id, cores_needed: 1, sort: "km" } })) as unknown as { options: RouteOption[] };
      const op = r.options[0];
      if (!op) return fail("No route found");
      setMsg({ text: `${op.spans.length} ${op.spans.length === 1 ? "span" : "spans"}, ${Number(op.total_km.toFixed(1))} km`, ok: true });
      onFound({ ids: op.spans.map((s) => s.span_id), km: op.total_km });
    } catch { fail("Could not load the route. Try again."); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); search(); };
  const swap = () => { setA(b); setB(a); if (a && b) search(b, a); };

  return (
    <section className="card col-span-12 px-4 py-3" aria-label="Route search">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="w-56"><span className="lbl">Route A</span><input className="field" list="route-sites" value={a} onChange={(e) => setA(e.target.value)} autoComplete="off" /></label>
        <button type="button" className="btn px-3" onClick={swap} aria-label="Swap A and B">&#8646;</button>
        <label className="w-56"><span className="lbl">Route B</span><input className="field" list="route-sites" value={b} onChange={(e) => setB(e.target.value)} autoComplete="off" /></label>
        <button type="submit" className="btn btn-p" disabled={!eps.length}>Search</button>
        {msg && <span role="status" data-testid="route-found" className={`self-center font-semibold ${msg.ok ? "text-foreground" : "text-red"}`}>{msg.text}</span>}
        <datalist id="route-sites">{eps.map((e) => <option key={e.id} value={e.name} />)}</datalist>
      </form>
    </section>
  );
}

export function SpanCard({ d, loss }: { d: Detail; loss: LossDetail | null }) {
  const cut = d.fiber_cut;
  const typeRoute = [d.route_type, d.route].filter(Boolean).join(", ");
  return (
    <section className="card" aria-labelledby="span-h" data-testid="span-card">
      <h2 id="span-h" className="mb-4 text-2xl leading-8 font-bold tracking-tight">{spanName(d)}</h2>
      <dl className="grid grid-cols-5 gap-4">
        <Metric label="Type and route" value={typeRoute || "-"} />
        <Metric label="Distance" value={d.distance_km ? `${Number(d.distance_km)} km` : "No distance"} />
        <Metric label="Free cores">
          <span className={`block text-2xl leading-8 font-bold tracking-tight ${cut ? "text-red" : ""}`}>
            {cut ? "Cut" : d.survey_cores == null ? "Not surveyed" : `${d.free_to_reserve} of ${d.survey_cores}`}
          </span>
        </Metric>
        <Metric label="Calculated loss" value={loss?.calculated_db != null ? db(loss.calculated_db) : "-"} />
        <Metric label="Worst core" value={(loss && worstText(loss)) ?? "Not measured"} />
      </dl>
    </section>
  );
}

// One line per count-only reservation: cores requested but not yet assigned to specific cores.
export const Unassigned = ({ d }: { d: Detail }) => d.unassigned.length > 0 && (
  <ul className="mt-3 space-y-1 text-body" data-testid="unassigned">
    {d.unassigned.map((u) => (
      <li key={u.reservation_id} className="flex items-center gap-2">
        <Icon name="co" className="ic text-use" />
        <span><b className="font-semibold">{u.remaining} {u.remaining === 1 ? "core" : "cores"}</b> requested, not assigned yet{u.customer ? `, ${u.customer}` : ""}</span>
      </li>
    ))}
  </ul>
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="lbl">{label}</dt><dd className="mt-0.5 font-semibold break-words">{children}</dd></div>;
}

export function CoreCard({ d, core, loss, onOpen }: { d: Detail; core: Core; loss: LossDetail | null; onOpen: () => void }) {
  const st = STATUS[core.status];
  const free = core.status === "Available";
  const cl = loss?.cores.find((c) => c.core_id === core.id) ?? null;
  const calc = loss?.calculated_db ?? null;
  return (
    <section className="card" aria-labelledby="core-h" data-testid="core-card">
      <div className="card-h items-center">
        <h2 id="core-h" className="flex items-center gap-3">Core {core.number} of {spanName(d)}
          {core.stale && <span className="pill h-amber"><Icon name="lo" />Stale</span>}
        </h2>
        <button type="button" className="btn btn-sm" onClick={onOpen}>History and actions</button>
      </div>
      <dl className="grid grid-cols-5 gap-4 text-body">
        <Field label="Status"><span className={`inline-flex items-center gap-1.5 ${st.tone}`}><Icon name={st.icon} />{statusLabel(core.status)}</span></Field>
        <Field label="Customer">{free ? <Blank>None</Blank> : core.customer ?? <Blank />}</Field>
        <Field label="Planned date">{free ? <Blank>None</Blank> : core.planned_date ?? <Blank />}</Field>
        <Field label="Ports">{free ? <Blank>None</Blank> : core.port_a || core.port_b ? <>{core.port_a ?? <Blank />} to {core.port_b ?? <Blank />}</> : <Blank>No ports yet</Blank>}</Field>
        <Field label="Circuit ID">{free ? <Blank>None</Blank> : core.circuit_id ? <span className="font-mono">{core.circuit_id}</span> : <Blank />}</Field>
      </dl>

      <h3 className="lbl mt-4 mb-1 border-t pt-3">Loss of this core</h3>
      {!loss ? <p className="text-body text-muted-foreground">Loading loss...</p> : !cl ? (
        <p role="status" className="note px-3 py-2 text-body" data-testid="core-no-loss">
          No loss test yet. {calc != null ? `Calculated loss for the span is ${db(calc)}.` : "No distance, so no calculated loss."}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-4 gap-4" data-testid="core-loss">
            <Metric label="Calculated" value={cl.calculated_db == null ? "No distance" : db(cl.calculated_db)} />
            <Metric label="Latest measured" value={db(cl.measured_db)} />
            <Metric label="Difference" value={cl.deviation_pct == null ? "-" : pct(cl.deviation_pct)} />
            <Metric label="Level">{cl.level ? <span className="mt-1.5 block"><LossPill l={cl} /></span> : <span className="block text-2xl leading-8 font-bold text-muted-foreground">-</span>}</Metric>
          </dl>
          <table className="tbl mt-3 table-fixed" data-testid="core-tests">
            <caption className="sr-only">Loss tests of core {core.number}, newest first</caption>
            <thead><tr>
              <th scope="col" className="w-[18%]">Tested</th><th scope="col" className="w-[18%]">Measured</th><th scope="col" className="w-[18%]">Difference</th>
              <th scope="col">Method</th><th scope="col" className="pr-0!">Verified by</th>
            </tr></thead>
            <tbody>
              {cl.history.map((h, i) => (
                <tr key={i}>
                  <th scope="row" className="text-left font-semibold">{h.tested_on ?? <Blank />}</th>
                  <td>{db(h.loss_db)}</td>
                  <td>{calc ? pct(((h.loss_db - calc) / calc) * 100) : <Blank>Not applicable</Blank>}</td>
                  <td className="truncate">{h.test_method ?? <Blank />}</td>
                  <td className="truncate pr-0">{h.field_team ?? <Blank />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
