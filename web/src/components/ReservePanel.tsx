import { useEffect, useRef, useState } from "react";
import { api, ApiError, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/lib/status";

type Customer = components["schemas"]["Customer"];
type Picked = Customer & { isNew?: boolean };

// Native modal <dialog>: browser provides the focus trap, Escape to close and focus return to the opener.
export function ReservePanel({ spanLabel, cores, onClose, onDone }: {
  spanLabel: string;
  cores: { id: number; number: number }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [needed, setNeeded] = useState(cores.length);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Picked | null>(null);
  const [similar, setSimilar] = useState<Customer[] | null>(null);
  const [date, setDate] = useState("");
  const [tried, setTried] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    dlg.current?.showModal();
    return () => dlg.current?.close();
  }, []);

  useEffect(() => {
    if (customer) return;
    let stale = false;
    const t = setTimeout(() => {
      api.get("/api/customers", { query: { q: q.trim() || undefined } }).then((r) => !stale && setMatches(r)).catch(() => {});
    }, 150);
    return () => { stale = true; clearTimeout(t); };
  }, [q, customer]);

  const exact = matches.some((m) => m.name.toLowerCase() === q.trim().toLowerCase());
  const addNew = async (confirmNew: boolean) => {
    try {
      const r = await api.post("/api/customers", { body: { name: q.trim(), confirm_new: confirmNew } });
      if (r.customer) setCustomer({ ...r.customer, isNew: r.created });
      else setSimilar(r.similar); // similar names exist: warn, the planner confirms
    } catch {
      setMsg("Could not check the customer name. Try again.");
    }
  };

  // Native modal already inerts the page; wrap Tab so focus never leaves for the browser chrome.
  const trap = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== "Tab") return;
    const f = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, textarea, [href]")];
    const [first, last] = [f[0], f[f.length - 1]];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const mismatch = cores.length !== needed;
  const problem = !customer ? "Choose a customer before submitting." : cores.length === 0 ? "Select at least one Available core in the grid." : mismatch ? `Chosen ${cores.length} cores but ${needed} needed.` : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problem || !customer) return;
    setBusy(true);
    try {
      const r = await api.post("/api/reservations", { body: { customer_id: customer.id, planned_date: date || null, cores: cores.map((c) => c.id) } });
      setMsg(`Request #${r.id} sent (${r.status}). Nothing is reserved until an admin approves.`);
      setSent(true);
      onDone();
    } catch (err) {
      setMsg(errorText(err, "Submit failed. Try again.") + (err instanceof ApiError && err.status === 409 ? " Close this panel and pick again." : ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dlg}
      onClose={onClose}
      onKeyDown={trap}
      aria-labelledby="reserve-h"
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-md overflow-auto border-l bg-background p-5 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="flex items-start justify-between gap-2">
          <h2 id="reserve-h" className="text-lg font-semibold">Reserve cores<span className="block text-sm font-normal text-muted-foreground">{spanLabel}</span></h2>
          <Button type="button" variant="outline" size="sm" onClick={() => dlg.current?.close()}>Close</Button>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Customer (required)</legend>
          {customer ? (
            <p className="flex items-center justify-between gap-2 text-sm">
              <span>{customer.name}{customer.isNew && " (new customer)"}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => { setCustomer(null); setSimilar(null); }}>Change</Button>
            </p>
          ) : (
            <>
              <input aria-label="Search customers" className={`${inputCls} w-full`} value={q} onChange={(e) => { setQ(e.target.value); setSimilar(null); }} placeholder="Type a customer name" />
              <ul className="max-h-40 space-y-1 overflow-auto">
                {matches.map((m) => (
                  <li key={m.id}><Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setCustomer(m)}>{m.name}</Button></li>
                ))}
              </ul>
              {q.trim() && !exact && <Button type="button" variant="secondary" size="sm" onClick={() => addNew(false)}>Add "{q.trim()}" as a new customer</Button>}
              {similar && similar.length > 0 && (
                <div role="alert" className="rounded-lg border-2 border-foreground p-2 text-sm">
                  <strong>Warning: similar customers already exist:</strong>
                  <ul className="list-disc pl-5">{similar.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {similar.map((s) => <Button key={s.id} type="button" size="sm" variant="outline" onClick={() => setCustomer(s)}>Use {s.name}</Button>)}
                    <Button type="button" size="sm" variant="outline" onClick={() => addNew(true)}>Create new anyway</Button>
                  </div>
                </div>
              )}
            </>
          )}
          {tried && !customer && <p role="alert" className="text-sm font-medium text-destructive">Choose a customer before submitting.</p>}
        </fieldset>

        <label className="block text-sm font-medium">Planned date
          <input type="date" className={`${inputCls} mt-1 block w-full`} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <div className="space-y-1 text-sm">
          <label className="font-medium">Cores needed{" "}
            <input type="number" min={1} className={`${inputCls} w-20`} value={needed} onChange={(e) => setNeeded(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <p aria-live="polite" data-testid="counter"><strong>{cores.length} of {needed}</strong> cores chosen{cores.length > 0 && `: ${cores.map((c) => c.number).join(", ")}`}</p>
        </div>

        {tried && problem && customer && <p role="alert" className="text-sm font-medium text-destructive">{problem}</p>}
        {msg && <p role="status" className="rounded-lg border p-2 text-sm">{msg}</p>}
        <Button type="submit" disabled={busy || sent}>Submit request</Button>
      </form>
    </dialog>
  );
}
