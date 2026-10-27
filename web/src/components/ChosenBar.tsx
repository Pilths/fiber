import { useEffect, useId, useState } from "react";
import { api, ApiError, errorText } from "@/api/client";
import type { components } from "@/api/schema";

type Customer = components["schemas"]["Customer"];
type Picked = Customer & { isNew?: boolean };

// Customer lookup shared by the chosen bar and "Reserve on this route": typeahead over /api/customers,
// "Add as new", and the similar-name warning (confirm_new). Returns the field and the warning as elements.
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
    <div className="relative grid min-w-[240px] flex-[0_1_440px] gap-1" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setListOpen(false)}>
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
          onKeyDown={(e) => e.key === "Escape" && setListOpen(false)} />
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

// Chosen bar (replaces the Reserve side panel): customer lookup, similar-name warning and
// POST /api/reservations. Sticky to the viewport bottom while the cores card is in view (CSS .cfoot).
export function ChosenBar({ cores, free, onClear, onDone }: {
  cores: { id: number; number: number }[];
  free: number;
  onClear: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState("");
  const [tried, setTried] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const { customer, field, warning } = useCustomerPicker((text) => setMsg({ text, ok: false }));

  const n = cores.length;
  const left = free - n;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!customer || n === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post("/api/reservations", { body: { customer_id: customer.id, planned_date: date || null, cores: cores.map((c) => c.id) } });
      setMsg({ text: `Request #${r.id} sent (${r.status}). Nothing is reserved until an admin approves.`, ok: true });
      setTried(false);
      onDone();
    } catch (err) {
      setMsg({ text: errorText(err, "Submit failed. Try again.") + (err instanceof ApiError && err.status === 409 ? " Clear the choice and pick again." : ""), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="cfoot" data-has={n > 0} onSubmit={submit} noValidate aria-label="Chosen cores" data-testid="chosen-bar">
      <div className="flex min-h-[30px] flex-wrap items-center gap-x-3 gap-y-2">
        <b className="text-sm font-bold" aria-live="polite">{n === 0 ? "No cores chosen" : `${n} ${n === 1 ? "core" : "cores"} chosen`}</b>
        {n > 0 && <span className="flex flex-wrap gap-1">{cores.map((c) => <span key={c.id} className="cchip">{c.number}</span>)}</span>}
        <span className={`text-body ${left < 0 ? "font-bold text-red" : "text-muted-foreground"}`}>
          {n === 0 ? `Up to ${free} cores per request` : left >= 0 ? `${left} more can be chosen` : `Only ${free} free to reserve: remove ${-left}`}
        </span>
        <button type="button" className="btn ml-auto" onClick={onClear} disabled={n === 0}>Clear</button>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {field}
        <label className="grid flex-[0_0_160px] gap-1"><span className="lbl">Planned date</span>
          <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-p min-w-[140px]" disabled={busy || n === 0}>{n ? `Reserve ${n} ${n === 1 ? "core" : "cores"}` : "Reserve"}</button>
      </div>

      {warning}
      {tried && !customer && n > 0 && <p role="alert" className="mt-2.5 text-body font-bold text-red">Choose a customer before submitting.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2.5 text-body ${msg.ok ? "font-semibold" : "font-bold text-red"}`}>{msg.text}</p>}
      {!msg && !(tried && !customer) && (
        <p className="mt-2.5 text-body text-muted-foreground">
          {n === 0 ? "Reserve is off: choose at least one Available core in the grid." : <>Goes to an admin for approval. Free to reserve after this: <b className="font-bold text-foreground">{Math.max(left, 0)} of {free}</b>.</>}
        </p>
      )}
    </form>
  );
}
