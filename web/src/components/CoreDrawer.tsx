import { useCallback, useEffect, useState } from "react";
import { api, errorText, resAction } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { Dialog } from "@/components/upload-parts";
import { EVENT_WORD, STATUS, when } from "@/lib/status";

type Core = components["schemas"]["CoreDetail"];
type Holder = components["schemas"]["Holder"];
type Item = components["schemas"]["CoreHistoryItem"];
type Me = components["schemas"]["CurrentUser"];

const line = (h: Item) =>
  h.kind === "data_edit"
    ? `${h.type === "status" ? `Marked ${h.new_value ?? "-"}` : `${h.type} changed to ${h.new_value ?? "blank"}`} by ${h.user}`
    : `${EVENT_WORD[h.type] ?? h.type} by ${h.user}`;

// Core detail: right-side drawer on the native <dialog> (Esc closes, focus returns to the cell or row that opened it).
// The holder comes from GET /api/cores/{id}: everyone sees who holds a core; actions follow holder.is_mine or admin.
export function CoreDrawer({ core, span, me, onClose, onChanged }: { core: Core; span: string; me: Me; onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [res, setRes] = useState<Holder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"status" | null>(null);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
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
      setMode(null);
      setReason("");
      setTried(false);
      onChanged();
      load();
    } catch (e) {
      setError(errorText(e, "Action failed. Try again."));
    } finally {
      setBusy(false);
    }
  };
  const target = core.status === "Faulty" ? "Available" : "Faulty";
  const setStatus = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!reason.trim()) return;
    act(() => api.post("/api/admin/cores/{cid}/status", { path: { cid: core.id }, body: { status: target, reason: reason.trim() } }));
  };

  const st = STATUS[core.status];
  const canKeep = res && (res.is_mine || admin) && res.state === "approved";
  const canRelease = admin && res?.state === "release_requested";
  // The holder has no list of requested cores; admins see every reservation, so read it at click time.
  const release = async (rid: number) => {
    const r = (await api.get("/api/reservations")).find((x) => x.id === rid);
    return resAction(rid, "release", { cores: r?.release_requested_cores ?? [] });
  };
  const facts: [string, React.ReactNode][] = [
    ["Customer", core.customer ?? "-"],
    ["Held by", res ? `${res.owner.display_name}, reservation #${res.reservation_id}` : "-"],
    ["Ports", core.port_a || core.port_b ? `${core.port_a ?? "-"} to ${core.port_b ?? "-"}` : "-"],
    ["Circuit", core.circuit_id ? <span key="c" className="font-mono">{core.circuit_id}</span> : "-"],
    ["Planned date", core.planned_date ?? "-"],
  ];

  return (
    <Dialog title={`Core ${core.number} on ${span}`} onClose={onClose}
      cls="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-[460px] max-w-none overflow-y-auto rounded-none border-y-0 border-r-0 [&>h2]:pr-20">
      <button type="button" className="btn btn-sm absolute top-4 right-4" onClick={onClose} aria-label="Close core detail">Close</button>
      <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="core-status">
        <span className={`inline-flex items-center gap-1.5 font-semibold ${st.tone}`}><Icon name={st.icon} />{core.status}</span>
        {res?.stale && <span className="pill h-amber"><Icon name="lo" />Stale</span>}
        {res?.state === "release_requested" && <span className="pill h-blue"><Icon name="ex" />Release requested</span>}
      </div>
      <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 border-t pt-4 text-body">
        {facts.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
      </dl>
      {res?.stale && <p className="mt-3 text-body text-amber">Stale: no approval or keep for over 3 months. Keep it or request release.</p>}

      {error && <p role="alert" className="mt-4 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">{error}</p>}

      {(canKeep || canRelease) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
          {canKeep && <button type="button" className="btn" disabled={busy} onClick={() => act(() => resAction(res.reservation_id, "keep"))}>Keep</button>}
          {canKeep && <button type="button" className="btn" disabled={busy} onClick={() => act(() => resAction(res.reservation_id, "request-release", { cores: [core.id] }))}>Request release of core {core.number}</button>}
          {canRelease && <button type="button" className="btn btn-p" disabled={busy} onClick={() => act(() => release(res.reservation_id))}>Release requested cores</button>}
        </div>
      )}

      {admin && (
        <div className="mt-4 border-t pt-4">
          {mode !== "status" ? (
            <>
              <button type="button" className="btn" onClick={() => setMode("status")}>Mark {target}</button>
              <p className="mt-1.5 text-body text-muted-foreground">
                {target === "Faulty"
                  ? core.status === "Available" ? "Faulty cores cannot be booked." : "Its reservation goes to Action needed. In use and Reserved are not set here: they come from the Excel and the reservation flow."
                  : "Only a Faulty core can be marked Available here."}
              </p>
            </>
          ) : (
            <form onSubmit={setStatus} noValidate aria-label={`Mark core ${core.number} ${target}`}>
              <label className="block"><span className="lbl mb-1 block text-body! text-foreground!">Reason (required)</span>
                <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus aria-invalid={tried && !reason.trim()} />
              </label>
              {tried && !reason.trim() && <p role="alert" className="mt-1.5 text-body font-semibold text-red">Enter a reason: every edit is kept as history.</p>}
              <div className="mt-3 flex gap-2">
                <button type="submit" className="btn btn-p" disabled={busy}>Mark {target}</button>
                <button type="button" className="btn" onClick={() => { setMode(null); setTried(false); }}>Cancel</button>
              </div>
            </form>
          )}
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
