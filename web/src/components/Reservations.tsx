import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, resAction, type Action } from "@/api/client";
import type { components } from "@/api/schema";
import { Button } from "@/components/ui/button";
import { EVENT_WORD, inputCls, when } from "@/lib/status";

type Res = components["schemas"]["ReservationOut"];
type Item = components["schemas"]["NeedsReviewItem"];
type Me = components["schemas"]["CurrentUser"];
type Event = components["schemas"]["EventOut"];


// "History" disclosure: the reservation's events in order, loaded on first open.
export function ResHistory({ rid }: { rid: number }) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState(false);
  const load = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (!e.currentTarget.open) return;
    api.get("/api/reservations/{rid}/history", { path: { rid } }).then((r) => { setEvents(r); setError(false); }).catch(() => setError(true));
  };
  return (
    <details className="text-sm" onToggle={load} data-testid="res-history">
      <summary className="w-fit cursor-pointer font-semibold text-blue underline underline-offset-2">History</summary>
      {error ? <p role="alert" className="mt-2 text-red">Could not load the history.</p>
        : !events ? <p className="mt-2 text-muted-foreground">Loading…</p>
        : (
          <ol className="mt-2 border-l-2 border-rule pl-3">
            {events.map((ev) => (
              <li key={ev.id} className="py-1">
                <span className="font-semibold">{EVENT_WORD[ev.type] ?? ev.type}</span> by {ev.user}
                <span className="text-muted-foreground">, {when(ev.at)}</span>
                {ev.cores.length > 0 && <span>; cores {ev.cores.map((c) => c.number).join(", ")}</span>}
                {ev.unassigned_change != null && <span>; {ev.unassigned_change > 0 ? `${ev.unassigned_change} cores by count` : `${-ev.unassigned_change} assigned`}</span>}
                {(ev.customer || ev.planned_date) && <span>; now {[ev.customer, ev.planned_date && `planned ${ev.planned_date}`].filter(Boolean).join(", ")}</span>}
                {ev.reason && <span className="block text-muted-foreground">Reason: {ev.reason}</span>}
              </li>
            ))}
          </ol>
        )}
    </details>
  );
}

// Status is always text (and a symbol), never colour alone.
const STATUS_LABEL: Record<Res["status"], string> = {
  pending: "◔ Pending approval", approved: "▨ Approved", rejected: "✕ Rejected", withdrawn: "○ Withdrawn", ended: "○ Ended (released)",
};

function groupCores(r: Res) {
  const by = new Map<string, Res["cores"]>();
  for (const c of r.cores) by.set(c.span, [...(by.get(c.span) ?? []), c]);
  return [...by.entries()];
}

function Card({ r, me, onChanged }: { r: Res; me: Me; onChanged: () => void }) {
  const [mode, setMode] = useState<"reject" | "decline-release" | "request-release" | null>(null);
  const [reason, setReason] = useState("");
  const [pick, setPick] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const admin = me.role === "admin";
  const own = r.planner_id === me.id;
  const held = r.cores.filter((c) => c.held);

  const run = async (action: Action, body?: { reason?: string; cores?: number[] }) => {
    setBusy(true);
    setMsg(null);
    try {
      await resAction(r.id, action, body);
      setMode(null);
      setReason("");
      setPick(new Set());
      onChanged();
    } catch (e) {
      setMsg(errorText(e, "Action failed. Try again."));
    } finally {
      setBusy(false);
    }
  };
  const needsReason = mode === "reject" || mode === "decline-release";
  const toggle = (id: number) => setPick((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });

  return (
    <li className="space-y-2 rounded-xl border border-border bg-white p-4" data-testid="reservation">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">#{r.id} {r.customer}{r.is_new_customer && " (new customer)"}</h3>
        <span className="text-sm font-medium">{STATUS_LABEL[r.status]}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        Requested by {r.planner}{r.planned_date ? `, planned ${r.planned_date}` : ", no planned date"}
        {r.imported && ", imported"}. Last event: {r.last_event ?? "none"}, {r.age_days} days ago.
      </p>
      {r.awaiting && <p className="text-sm font-medium">{r.awaiting === "approval" ? "Waiting for approval" : "Release requested, waiting for an admin"} for {r.age_days} days.</p>}
      {r.stale && <p className="text-sm font-medium">Stale: no approval or keep for over 3 months.</p>}
      {r.last_reason && <p className="text-sm font-medium" role="note">{r.status === "rejected" ? "Rejection reason" : "Release declined"}: {r.last_reason}</p>}
      {r.unassigned_cores > 0 && (
        <p className="text-sm">{r.unassigned_cores} cores reserved by count on {r.unassigned_span}; <strong>{r.remaining_unassigned} not assigned yet</strong>.</p>
      )}
      {groupCores(r).map(([span, cores]) => (
        <p key={span} className="text-sm">{span}: cores {cores.map((c) => c.held ? c.number : `${c.number} (released)`).join(", ")}</p>
      ))}
      {r.release_requested_cores.length > 0 && (
        <p className="text-sm">Release requested for cores {r.cores.filter((c) => r.release_requested_cores.includes(c.core_id)).map((c) => c.number).join(", ")}.</p>
      )}

      {mode === "request-release" && (
        <fieldset className="text-sm">
          <legend className="font-medium">Cores to free (the rest stays reserved)</legend>
          {held.length === 0 && <p>No named cores; the whole count will be released.</p>}
          {held.map((c) => (
            <label key={c.core_id} className="mr-3 inline-flex items-center gap-1">
              <input type="checkbox" checked={pick.has(c.core_id)} onChange={() => toggle(c.core_id)} /> {c.span}: {c.number}
            </label>
          ))}
        </fieldset>
      )}
      {needsReason && (
        <label className="block text-sm font-medium">Reason (required)
          <input className={`${inputCls} mt-1 block w-full`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      {msg && <p role="alert" className="text-sm font-medium text-destructive">{msg}</p>}
      <ResHistory key={r.last_event_at ?? ""} rid={r.id} />

      <div className="flex flex-wrap gap-2">
        {mode ? (
          <>
            <Button size="sm" disabled={busy || (needsReason && !reason.trim()) || (mode === "request-release" && held.length > 0 && pick.size === 0)}
              onClick={() => run(mode, needsReason ? { reason: reason.trim() } : { cores: [...pick] })}>
              Confirm {mode === "reject" ? "rejection" : mode === "decline-release" ? "decline" : "release request"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setMode(null); setMsg(null); }}>Cancel</Button>
          </>
        ) : (
          <>
            {admin && r.awaiting === "approval" && <Button size="sm" disabled={busy} onClick={() => run("approve")}>Approve</Button>}
            {admin && r.awaiting === "approval" && <Button size="sm" variant="outline" onClick={() => setMode("reject")}>Reject</Button>}
            {admin && r.awaiting === "release" && (
              <Button size="sm" disabled={busy} onClick={() => run("release", { cores: r.release_requested_cores })}>Release requested cores</Button>
            )}
            {admin && r.awaiting === "release" && <Button size="sm" variant="outline" onClick={() => setMode("decline-release")}>Decline release</Button>}
            {own && r.status === "pending" && <Button size="sm" variant="outline" disabled={busy} onClick={() => run("withdraw")}>Withdraw</Button>}
            {(own || admin) && r.status === "approved" && r.awaiting !== "release" && (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run("keep")}>Keep</Button>
                <Button size="sm" variant="outline" onClick={() => setMode("request-release")}>Request release</Button>
              </>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const latest = useRef(load);
  const reload = useCallback(() => {
    latest.current().then((d) => { setData(d); setError(false); }).catch(() => setError(true));
  }, []);
  useEffect(() => {
    latest.current = load;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);
  return { data, error, reload };
}

const FILTERS: [string, Res["status"] | undefined][] = [["All", undefined], ["Pending", "pending"], ["Approved", "approved"], ["Rejected", "rejected"]];

export function MyReservations({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [status, setStatus] = useState<Res["status"] | undefined>();
  const { data, error, reload } = useLoad(() => api.get("/api/reservations", { query: { mine: true, status } }), [status]);
  return (
    <section aria-labelledby="mine-h" className="card mx-auto w-full max-w-4xl space-y-3">
      <h2 id="mine-h" className="text-base leading-6 font-semibold">My reservations</h2>
      <div role="group" aria-label="Filter by status" className="flex gap-2">
        {FILTERS.map(([label, v]) => (
          <Button key={label} size="sm" variant={status === v ? "secondary" : "outline"} aria-pressed={status === v} onClick={() => setStatus(v)}>{label}</Button>
        ))}
      </div>
      {error && <p role="alert">Could not load reservations.</p>}
      {data && data.length === 0 && <p>No reservations{status ? ` that are ${status}` : ""}.</p>}
      <ul className="space-y-3">{data?.map((r) => <Card key={r.id} r={r} me={me} onChanged={() => { reload(); onChanged(); }} />)}</ul>
    </section>
  );
}

export function Approvals({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => api.get("/api/approvals"));
  return (
    <section aria-labelledby="appr-h" className="card mx-auto w-full max-w-4xl space-y-3">
      <h2 id="appr-h" className="text-base leading-6 font-semibold">Approvals{data ? ` (${data.length})` : ""}</h2>
      <p className="text-sm text-muted-foreground">New requests and release requests, oldest first.</p>
      {me.role !== "admin" && <p role="alert">Admins only.</p>}
      {error && me.role === "admin" && <p role="alert">Could not load approvals.</p>}
      {data && data.length === 0 && <p>Nothing is waiting.</p>}
      <ul className="space-y-3">{data?.map((r) => <Card key={r.id} r={r} me={me} onChanged={() => { reload(); onChanged(); }} />)}</ul>
    </section>
  );
}

export function NeedsReview({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => api.get("/api/needs-review"));
  return (
    <section aria-labelledby="nr-h" className="card mx-auto w-full max-w-4xl space-y-3">
      <h2 id="nr-h" className="text-base leading-6 font-semibold">Action needed{data ? ` (${data.length})` : ""}</h2>
      <p className="text-sm text-muted-foreground">Stale reservations, release requests and held cores that went faulty.</p>
      {error && <p role="alert">Could not load the list.</p>}
      {data && data.length === 0 && <p>Nothing needs action.</p>}
      <div className="space-y-3">
        {data?.map((i: Item, n) => (
          <div key={`${i.kind}-${i.reservation.id}-${n}`} className="space-y-1">
            <p className="text-sm font-semibold">{i.detail}</p>
            <ul><Card r={i.reservation} me={me} onChanged={() => { reload(); onChanged(); }} /></ul>
          </div>
        ))}
      </div>
    </section>
  );
}
