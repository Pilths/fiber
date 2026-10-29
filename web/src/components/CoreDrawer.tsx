import { useCallback, useEffect, useState } from "react";
import { api, errorText, resAction } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { Blank } from "@/components/LossCard";
import { Dialog } from "@/components/upload-parts";
import { EVENT_WORD, STATUS, statusLabel, when } from "@/lib/status";

type Core = components["schemas"]["CoreDetail"];
type Holder = components["schemas"]["Holder"];
type Item = components["schemas"]["CoreHistoryItem"];
type Me = components["schemas"]["CurrentUser"];

const line = (h: Item) =>
  h.kind === "data_edit"
    ? `${h.type === "status" ? `Marked ${h.new_value == null ? "-" : statusLabel(h.new_value)}` : `${h.type} changed to ${h.new_value ?? "blank"}`} by ${h.user}`
    : `${EVENT_WORD[h.type] ?? h.type} by ${h.user}`;

// Core detail: right-side drawer on the native <dialog> (Esc closes, focus returns to the cell or row that opened it).
// The holder comes from GET /api/cores/{id}: everyone sees who holds a core; actions follow holder.is_mine or admin.
export function CoreDrawer({ core, span, ends, me, onClose, onChanged }: {
  core: Core; span: string; ends: [string, string]; me: Me; onClose: () => void; onChanged: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [res, setRes] = useState<Holder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ports, setPorts] = useState(false);
  const admin = me.role === "admin";

  const load = useCallback(() => {
    api.get("/api/cores/{cid}/history", { path: { cid: core.id } }).then(setItems).catch(() => setError("Could not load the history."));
    api.get("/api/cores/{core_id}", { path: { core_id: core.id } }).then((c) => setRes(c.holder)).catch(() => setRes(null));
  }, [core.id]);
  useEffect(load, [load, core.status]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      load();
    } catch (e) {
      setError(errorText(e, "Action failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const st = STATUS[core.status];
  const canKeep = res && (res.is_mine || admin) && res.state === "approved";
  const canRelease = admin && res?.state === "release_requested";
  // The holder has no list of requested cores; admins see every reservation, so read it at click time.
  const release = async (rid: number) => {
    const r = (await api.get("/api/reservations")).find((x) => x.id === rid);
    return resAction(rid, "release", { cores: r?.release_requested_cores ?? [] });
  };
  const na = core.status === "Available" ? <Blank>Not applicable</Blank> : <Blank />;
  const facts: [string, React.ReactNode][] = [
    ["Customer", core.customer ?? na],
    ["Reserved by", res ? `${res.owner.display_name}, reservation #${res.reservation_id}` : <Blank key="r">Not applicable</Blank>],
    ["Ports", core.port_a || core.port_b ? <span key="p">{core.port_a ?? <Blank />} to {core.port_b ?? <Blank />}</span> : <Blank key="p">No ports yet</Blank>],
    ["Circuit", core.circuit_id ? <span key="c" className="font-mono">{core.circuit_id}</span> : <Blank key="c">{core.status === "Available" ? "Not applicable" : "Not recorded"}</Blank>],
    ["Planned date", core.planned_date ?? na],
  ];

  return (
    <Dialog title={`Core ${core.number} on ${span}`} onClose={onClose}
      cls="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-[460px] max-w-none overflow-y-auto rounded-none border-y-0 border-r-0 [&>h2]:pr-20">
      <button type="button" className="btn btn-sm absolute top-4 right-4" onClick={onClose} aria-label="Close core detail">Close</button>
      <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="core-status">
        <span className={`inline-flex items-center gap-1.5 font-semibold ${st.tone}`}><Icon name={st.icon} />{statusLabel(core.status)}</span>
        {res?.stale && <span className="pill h-amber"><Icon name="lo" />Stale</span>}
        {res?.state === "release_requested" && <span className="pill h-blue"><Icon name="ex" />Release requested</span>}
      </div>
      <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 border-t pt-4 text-body">
        {facts.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
      </dl>
      {admin && <button type="button" className="btn btn-sm mt-3" onClick={() => setPorts(true)}>{core.port_a || core.port_b ? "Edit ports" : "Add ports"}</button>}
      {ports && <PortsDialog core={core} ends={ends} onClose={() => setPorts(false)} onSaved={() => { onChanged(); load(); }} />}

      {error && <p role="alert" className="mt-4 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">{error}</p>}

      {(canKeep || canRelease) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
          {canKeep && <button type="button" className="btn" disabled={busy} onClick={() => act(() => resAction(res.reservation_id, "keep"))}>Keep</button>}
          {canKeep && <button type="button" className="btn" disabled={busy} onClick={() => act(() => resAction(res.reservation_id, "request-release", { cores: [core.id] }))}>Request release of core {core.number}</button>}
          {canRelease && <button type="button" className="btn btn-p" disabled={busy} onClick={() => act(() => release(res.reservation_id))}>Release requested cores</button>}
        </div>
      )}

      <h3 className="mt-5 border-t pt-4 text-sm font-semibold">History</h3>
      {!items ? <p className="mt-2 text-body text-muted-foreground">Loading…</p>
        : items.length === 0 ? <p className="mt-2 text-body text-muted-foreground">No events on this core{admin ? "" : " that you can see"}.</p>
        : (
          <ol className="mt-2 text-body" aria-label="Core history, newest first">
            {items.map((h, i) => (
              <li key={i} className="border-b border-rule py-2 last:border-b-0">
                <span className="font-semibold">{line(h)}</span>
                {h.reservation_id != null && <span className="text-muted-foreground"> (reservation #{h.reservation_id})</span>}
                <span className="block text-muted-foreground">{when(h.at)}</span>
                {h.reason && <span className="block">Reason: {h.reason}</span>}
              </li>
            ))}
          </ol>
        )}
    </Dialog>
  );
}

// Ports are typed by hand (the reservation upload does not import them). An empty field clears that end.
function PortsDialog({ core, ends, onClose, onSaved }: { core: Core; ends: [string, string]; onClose: () => void; onSaved: () => void }) {
  const [a, setA] = useState(core.port_a ?? "");
  const [b, setB] = useState(core.port_b ?? "");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lbl = "lbl mb-1 block text-body! text-foreground!";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/cores/{core_id}/ports", { path: { core_id: core.id }, body: { port_a: a.trim() || null, port_b: b.trim() || null, reason: reason.trim() } });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not save. Try again."));
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Ports of core ${core.number}`} onClose={onClose}>
      {error && <p role="alert" className="mt-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">{error}</p>}
      <form onSubmit={submit} noValidate aria-label={`Ports of core ${core.number}`} className="mt-4 space-y-3">
        <label className="block"><span className={lbl}>Port at {ends[0]}</span><input className="field" value={a} onChange={(e) => setA(e.target.value)} autoFocus /></label>
        <label className="block"><span className={lbl}>Port at {ends[1]}</span><input className="field" value={b} onChange={(e) => setB(e.target.value)} /></label>
        <p className="text-body text-muted-foreground">Leave a field empty to clear that end.</p>
        <label className="block"><span className={lbl}>Reason (required)</span>
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={tried && !reason.trim()} />
          {tried && !reason.trim() && <span role="alert" className="mt-1 block text-body font-semibold text-red">Enter a reason: every edit is kept as history.</span>}
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-p" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}
