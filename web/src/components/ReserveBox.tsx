import { Fragment, useEffect, useId, useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { Blank } from "@/components/LossCard";
import { Dialog } from "@/components/upload-parts";
import { db } from "@/lib/status";

type Customer = components["schemas"]["Customer"];
type Picked = Customer & { isNew?: boolean };
type Core = components["schemas"]["CoreDetail"];
type LossDetail = components["schemas"]["SegmentLossDetail"];

// Customer lookup for the Reserve box: typeahead over /api/customers, "Add as new", and the similar-name
// warning (confirm_new). Returns the field and the warning as elements.
export function useCustomerPicker(onError: (text: string) => void) {
  const id = useId();
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<Customer[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [similar, setSimilar] = useState<Customer[] | null>(null);

  useEffect(() => {
    if (customer || !listOpen) return;
    let stale = false;
    const t = setTimeout(() => {
      api.get("/api/customers", { query: { q: q.trim() || undefined } }).then((r) => !stale && setMatches(r)).catch(() => {});
    }, 150);
    return () => { stale = true; clearTimeout(t); };
  }, [q, customer, listOpen]);

  const choose = (c: Picked) => { setCustomer(c); setSimilar(null); setListOpen(false); };
  const exact = matches.some((m) => m.name.toLowerCase() === q.trim().toLowerCase());
  const addNew = async (confirmNew: boolean) => {
    try {
      const r = await api.post("/api/customers", { body: { name: q.trim(), confirm_new: confirmNew } });
      if (r.customer) choose({ ...r.customer, isNew: r.created });
      else { setSimilar(r.similar); setListOpen(false); } // similar names exist: warn, the planner confirms
    } catch {
      onError("Could not check the customer name. Try again.");
    }
  };

  const field = (
    <div className="relative grid min-w-[240px] flex-[1_1_320px] gap-1" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setListOpen(false)}>
      <label htmlFor={`${id}-c`} className="lbl">Customer (required)</label>
      {customer ? (
        <p className="flex h-9 items-center justify-between gap-2 rounded-md border border-line bg-white pl-3 pr-1">
          <span className="truncate font-semibold">{customer.name}{customer.isNew && " (new customer)"}</span>
          <button type="button" id={`${id}-c`} className="btn h-7 px-2.5 text-body" onClick={() => { setCustomer(null); setListOpen(true); }}>Change</button>
        </p>
      ) : (
        <input id={`${id}-c`} aria-label="Search customers" role="combobox" aria-expanded={listOpen} aria-controls={`${id}-l`} aria-autocomplete="list"
          className="field" placeholder="Type a customer name" value={q} autoComplete="off"
          onChange={(e) => { setQ(e.target.value); setSimilar(null); setListOpen(true); }}
          onFocus={() => setListOpen(true)}
          onKeyDown={(e) => { if (e.key === "Escape" && listOpen) { e.preventDefault(); e.stopPropagation(); setListOpen(false); } }} />
      )}
      {!customer && listOpen && (q.trim() || matches.length > 0) && (
        <div id={`${id}-l`} className="absolute bottom-[42px] left-0 right-0 z-10 max-h-56 overflow-auto rounded-xl border border-line bg-white py-1.5">
          <ul aria-label="Matching customers">
            {matches.map((m) => (
              <li key={m.id}><button type="button" className="block min-h-9 w-full px-3 text-left hover:bg-blue-bg focus-visible:-outline-offset-3" onClick={() => choose(m)}>{m.name}</button></li>
            ))}
          </ul>
          {q.trim() && !exact && (
            <button type="button" className="block min-h-9 w-full border-t px-3 text-left font-semibold text-blue hover:bg-blue-bg focus-visible:-outline-offset-3" onClick={() => addNew(false)}>
              Add "{q.trim()}" as a new customer
            </button>
          )}
        </div>
      )}
    </div>
  );
  const warning = similar && similar.length > 0 && (
    <div role="alert" className="mt-3 note p-3 text-body">
      <strong className="text-amber">Similar customers already exist:</strong> {similar.map((s) => s.name).join(", ")}
      <div className="mt-2 flex flex-wrap gap-2">
        {similar.map((s) => <button key={s.id} type="button" className="btn btn-sm" onClick={() => choose(s)}>Use {s.name}</button>)}
        <button type="button" className="btn btn-sm" onClick={() => addNew(true)}>Create new anyway</button>
      </div>
    </div>
  );
  return { customer, field, warning };
}

export type RouteLeg = { segment_id: number; name: string; free: number };
type Mode =
  | { kind: "segment"; cores: Core[]; free: number; km: number | null; loss: LossDetail | null }
  | { kind: "route"; legs: RouteLeg[]; need: number };

const cores = (n: number) => `${n} ${n === 1 ? "core" : "cores"}`;

// Reserve box: a modal over Inventory (or the route planner). Segment mode ticks Available cores; route mode takes
// N cores per segment through GET /api/routes/pick. Both send one POST /api/reservations.
export function ReserveBox({ sites, mode, onClose, onSent }: {
  sites: string[]; // the chain in travel order: two for a segment
  mode: Mode;
  onClose: () => void;
  onSent: (reservationId: number) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const back = useRef<Element | null>(null);
  const seg = mode.kind === "segment" ? mode : null;
  const avail = seg ? seg.cores.filter((c) => c.status === "Available").sort((a, b) => a.number - b.number) : [];
  const max = seg ? Math.min(seg.free, avail.length) : Math.min(...(mode.kind === "route" ? mode.legs.map((l) => l.free) : [0]));
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [perLeg, setPerLeg] = useState(mode.kind === "route" ? Math.max(1, Math.min(mode.need, max)) : 1);
  const n = seg ? ticked.size : perLeg;
  const total = seg ? n : n * sites.slice(1).length;
  const [date, setDate] = useState("");
  const [srf, setSrf] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const { customer, field, warning } = useCustomerPicker(setError);

  // Focus returns to the opener (the "Reserve cores" button). Kept from the first mount: StrictMode mounts twice.
  useEffect(() => {
    back.current ??= document.activeElement;
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => { d.close(); (back.current as HTMLElement | null)?.focus?.(); };
  }, []);

  const close = () => (seg && ticked.size ? setAsking(true) : onClose());
  const step = (to: number) => {
    const k = Math.max(1, Math.min(max, to));
    if (seg) setTicked(new Set(avail.slice(0, k).map((c) => c.id)));
    else setPerLeg(k);
  };
  const toggle = (cid: number) => setTicked((s) => { const x = new Set(s); if (!x.delete(cid)) x.add(cid); return x; });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!customer || !n) return;
    setBusy(true);
    setError(null);
    try {
      const ids = seg ? [...ticked]
        : ((await api.get("/api/routes/pick", { query: { segment_ids: mode.kind === "route" ? mode.legs.map((l) => l.segment_id) : [], cores_needed: n } })) as unknown as { core_ids: number[] }).core_ids;
      const r = await api.post("/api/reservations", { body: { customer_id: customer.id, planned_date: date || null, ...(srf.trim() && { srf_id: srf.trim() }), cores: ids } });
      onSent(r.id);
      onClose();
    } catch (err) {
      setError(errorText(err, "Submit failed. Try again."));
      setBusy(false);
    }
  };

  // Per core: calculated from the core's loss row when it has one, else the segment's calculated loss (same formula per segment).
  const lossOf = (c: Core) => seg?.loss?.cores.find((x) => x.core_id === c.id);
  const calcOf = (c: Core) => lossOf(c)?.calculated_db ?? seg?.loss?.calculated_db ?? null;

  return (
    <dialog ref={ref} aria-labelledby={`${id}-h`} data-testid="reserve-box"
      onCancel={(e) => { e.preventDefault(); if (!asking) close(); }}
      className="m-auto flex max-h-[640px] w-[1040px] max-w-[calc(100vw-32px)] flex-col overflow-visible rounded-lg border bg-white p-0 text-sm backdrop:bg-[#0a0a0a]/45">
      <header className="flex items-center gap-4 border-b px-5 py-3">
        <h2 id={`${id}-h`} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
          <span className="sr-only">Reserve on </span>
          {sites.map((s, i) => (
            <Fragment key={i}>
              {i > 0 && (seg
                ? <span aria-hidden className="flex items-center gap-1.5 text-blue">●<span className="h-0.5 w-6 bg-blue" /><span className="text-body font-semibold text-foreground">{seg.km == null ? "-" : `${seg.km} km`}</span><span className="h-0.5 w-6 bg-blue" />●</span>
                : <span aria-hidden className="flex items-center gap-1 text-blue">●<span className="h-0.5 w-6 bg-blue" /></span>)}
              {i > 0 && <span className="sr-only">to</span>}
              <span className="truncate">{s}</span>
            </Fragment>
          ))}
        </h2>
        {seg && <span className="font-semibold text-green" data-testid="reserve-free">{seg.free} free</span>}
        <button type="button" className="btn btn-sm px-2.5" aria-label="Close" onClick={close}>×</button>
      </header>

      <form onSubmit={submit} noValidate aria-label="Reserve cores" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">
          <div className="mb-3 flex items-center gap-3">
            <span id={`${id}-n`} className="font-semibold">{seg ? "Cores needed" : "Cores needed per segment"}</span>
            <div role="group" aria-labelledby={`${id}-n`} className="flex items-center gap-1">
              <button type="button" className="btn btn-sm w-8 px-0" aria-label="One fewer" disabled={n <= 1} onClick={() => step(n - 1)}>−</button>
              <output aria-live="polite" className="w-10 text-center text-base font-semibold tabular-nums" data-testid="reserve-n">{n}</output>
              <button type="button" className="btn btn-sm w-8 px-0" aria-label="One more" disabled={n >= max} onClick={() => step(n + 1)}>+</button>
            </div>
          </div>
          {seg ? (
            <table className="tbl [&_td]:h-9 [&_th]:h-9">
              <caption className="sr-only">Available cores</caption>
              <thead className="sticky top-0 bg-white"><tr>
                <th scope="col" className="w-12"><span className="sr-only">Chosen</span></th>
                <th scope="col" className="w-[14%]">Core</th>
                <th scope="col">Ports</th>
                <th scope="col" className="num w-[20%]">Calculated loss</th>
                <th scope="col" className="num w-[20%]">Measured loss</th>
              </tr></thead>
              <tbody>
                {avail.map((c) => {
                  const on = ticked.has(c.id), m = lossOf(c)?.measured_db, calc = calcOf(c);
                  const high = m != null && calc != null && m > calc;
                  return (
                    <tr key={c.id} className={on ? "bg-blue-bg" : ""} data-core={c.number}>
                      <td><input type="checkbox" className="size-4 accent-blue" aria-label={`Core ${c.number}`} checked={on}
                        disabled={!on && ticked.size >= max} onChange={() => toggle(c.id)} /></td>
                      <th scope="row" className="text-left font-semibold">{c.number}</th>
                      <td className="truncate">{c.port_a || c.port_b ? `${c.port_a ?? "-"} → ${c.port_b ?? "-"}` : <Blank>-</Blank>}</td>
                      <td className="num">{calc == null ? <Blank>-</Blank> : db(calc)}</td>
                      <td className="num">{m == null ? <Blank>Not tested</Blank>
                        : high ? <>{db(m)} <span aria-hidden className="text-amber">▲</span><span className="sr-only"> above calculated</span></>
                        : db(m)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : mode.kind === "route" && (
            <table className="tbl [&_td]:h-9 [&_th]:h-9">
              <caption className="sr-only">Segments on this route</caption>
              <thead className="sticky top-0 bg-white"><tr>
                <th scope="col">Segment</th><th scope="col" className="num w-[18%]">Free</th><th scope="col" className="num w-[18%]">Cores to take</th>
              </tr></thead>
              <tbody>
                {mode.legs.map((l) => (
                  <tr key={l.segment_id}><th scope="row" className="truncate text-left font-semibold">{l.name}</th><td className="num">{l.free}</td><td className="num">{n}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t px-5 py-4">
          {error && <p role="alert" className="mb-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">{error}</p>}
          <div className="flex flex-wrap items-end gap-3">
            {field}
            <label className="grid w-[170px] gap-1"><span className="lbl">Planned date</span>
              <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="grid w-[150px] gap-1"><span className="lbl">SRF ID (optional)</span>
              <input className="field" value={srf} onChange={(e) => setSrf(e.target.value)} autoComplete="off" />
            </label>
            <button type="submit" className="btn btn-p ml-auto min-w-[150px]" disabled={busy || !n}>{`Reserve ${cores(total)}`}</button>
          </div>
          {warning}
          {tried && !customer && <p role="alert" className="mt-2.5 text-body font-bold text-red">Choose a customer before submitting.</p>}
        </div>
      </form>

      {asking && (
        <Dialog title={`Discard ${ticked.size} chosen ${ticked.size === 1 ? "core" : "cores"}?`} onClose={() => setAsking(false)}>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setAsking(false)}>Keep editing</button>
            <button type="button" className="btn btn-p" onClick={onClose}>Discard</button>
          </div>
        </Dialog>
      )}
    </dialog>
  );
}
