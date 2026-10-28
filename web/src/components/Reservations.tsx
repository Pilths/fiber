import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, resAction, type Action } from "@/api/client";
import type { components } from "@/api/schema";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/Icon";
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

type Mode = "reject" | "decline-release" | "request-release" | null;

// One reservation's actions: run an action, then reset the open form and tell the parent to reload.
function useResAction(rid: number, onChanged: () => void) {
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [pick, setPick] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: Action, body?: { reason?: string; cores?: number[] }) => {
    setBusy(true);
    setMsg(null);
    try {
      await resAction(rid, action, body);
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
  return { mode, setMode, reason, setReason, pick, setPick, msg, setMsg, busy, run };
}

function Card({ r, me, onChanged }: { r: Res; me: Me; onChanged: () => void }) {
  const { mode, setMode, reason, setReason, pick, setPick, msg, setMsg, busy, run } = useResAction(r.id, onChanged);
  const admin = me.role === "admin";
  const own = r.planner_id === me.id;
  const held = r.cores.filter((c) => c.held);
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

const day = (iso: string | null) => iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : "—";

// Span or route of a request: one span name, or the first span and how many more (all of them in the details row).
function spanText(r: Res) {
  const spans = groupCores(r).map(([s]) => s);
  if (!spans.length) return r.unassigned_span ?? "—";
  return spans.length === 1 ? spans[0] : `${spans[0]} +${spans.length - 1} more`;
}

// Approvals (admin): one table of waiting requests, oldest first. Approve / Reject (or Release / Decline for a release
// request) sit at the right of each row; Reject and Decline open the row to ask for a reason. The chevron opens the
// row for its cores, notes and history.
export function Approvals({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => api.get("/api/approvals"));
  return (
    <section aria-labelledby="appr-h" className="card mx-auto w-full max-w-6xl">
      <div className="card-h">
        <h2 id="appr-h">Approvals{data ? ` (${data.length})` : ""}</h2>
      </div>
      {me.role !== "admin" && <p role="alert">Admins only.</p>}
      {error && me.role === "admin" && <p role="alert">Could not load approvals.</p>}
      {data && data.length === 0 && <p className="text-body text-muted-foreground">Nothing is waiting.</p>}
      {data && data.length > 0 && (
        <div className="tbox">
          <table className="tbl band" data-testid="approvals-table">
            <caption className="sr-only">Requests waiting for an admin, oldest first</caption>
            <thead><tr>
              <th scope="col" className="w-px"><span className="sr-only">Details</span></th>
              <th scope="col" className="w-px">Requested</th><th scope="col" className="w-px">Type</th><th scope="col">Planner</th><th scope="col">Customer</th>
              <th scope="col">Span or route</th><th scope="col" className="num w-px">Cores</th><th scope="col" className="w-px">Planned</th>
              <th scope="col" className="w-px text-right!"><span className="sr-only">Actions</span></th>
            </tr></thead>
            {data.map((r) => <ApprovalRow key={r.id} r={r} onChanged={() => { reload(); onChanged(); }} />)}
          </table>
        </div>
      )}
    </section>
  );
}

function ApprovalRow({ r, onChanged }: { r: Res; onChanged: () => void }) {
  const { mode, setMode, reason, setReason, msg, setMsg, busy, run } = useResAction(r.id, onChanged);
  const [open, setOpen] = useState(false);
  const release = r.awaiting === "release";
  const cores = release ? r.release_requested_cores.length : r.cores.length + r.unassigned_cores;
  const detailId = `appr-d-${r.id}`;
  const ask = (m: Mode) => { setMode(m); setReason(""); setMsg(null); setOpen(true); };
  return (
    <tbody data-testid="approval" className="border-b border-rule last:border-b-0 [&>tr>*]:border-b-0!">
      <tr className={open ? "bg-subtle" : ""}>
        <td className="pr-0!">
          <button type="button" className="grid size-7 place-items-center rounded-md hover:bg-rule" aria-expanded={open} aria-controls={detailId}
            aria-label={`Details of request #${r.id}`} onClick={() => setOpen((o) => !o)}>
            <svg viewBox="0 0 16 16" aria-hidden="true" className={`ni size-3.5! transition-transform ${open ? "rotate-90" : ""}`}><path d="M6 4l4 4-4 4" /></svg>
          </button>
        </td>
        <td>{day(r.last_event_at)} <span className="text-muted-foreground">· {r.age_days} d</span></td>
        <td>{release ? "Release" : "New"}</td>
        <td>{r.planner}</td>
        <th scope="row" className="text-left font-semibold">
          {r.customer}
          {r.is_new_customer && <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-amber"><Icon name="lo" />New customer</span>}
        </th>
        <td className="max-w-[320px] truncate" title={groupCores(r).map(([s]) => s).join(", ") || undefined}>{spanText(r)}</td>
        <td className="num">{cores}{!release && r.unassigned_cores > 0 && <span className="text-muted-foreground"> by count</span>}</td>
        <td>{r.planned_date ?? "—"}</td>
        <td className="text-right">
          <span className="inline-flex gap-2">
            {release ? (
              <>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run("release", { cores: r.release_requested_cores })}>Release</button>
                <button type="button" className="btn btn-sm" onClick={() => ask("decline-release")}>Decline</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-p btn-sm" disabled={busy} onClick={() => run("approve")}>Approve</button>
                <button type="button" className="btn btn-sm" onClick={() => ask("reject")}>Reject</button>
              </>
            )}
          </span>
        </td>
      </tr>
      <tr id={detailId} hidden={!open} className="bg-subtle">
        <td />
        <td colSpan={8} className="h-auto! py-3! whitespace-normal!">
          <div className="space-y-1.5 text-body">
            <p className="text-muted-foreground">Request #{r.id}{r.imported && ", imported"}. Last event: {r.last_event ?? "none"}, {r.age_days} days ago.{r.stale && " Stale: no approval or keep for over 3 months."}</p>
            {r.unassigned_cores > 0 && <p>{r.unassigned_cores} cores reserved by count on {r.unassigned_span}; {r.remaining_unassigned} not assigned yet.</p>}
            {groupCores(r).map(([span, cs]) => <p key={span}>{span}: cores {cs.map((c) => c.held ? c.number : `${c.number} (released)`).join(", ")}</p>)}
            {release && <p>Release requested for cores {r.cores.filter((c) => r.release_requested_cores.includes(c.core_id)).map((c) => c.number).join(", ") || "unassigned"}.</p>}
            {r.last_reason && <p role="note">{r.status === "rejected" ? "Rejection reason" : "Release declined"}: {r.last_reason}</p>}
            {mode && (
              <form className="flex items-end gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) run(mode, { reason: reason.trim() }); }}>
                <label className="w-[420px] font-medium">Reason (required)
                  <input className="field mt-1 bg-white" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                </label>
                <button type="submit" className="btn btn-p" disabled={busy || !reason.trim()}>Confirm {mode === "reject" ? "rejection" : "decline"}</button>
                <button type="button" className="btn" onClick={() => { setMode(null); setMsg(null); }}>Cancel</button>
              </form>
            )}
            {msg && <p role="alert" className="font-medium text-destructive">{msg}</p>}
            <ResHistory key={r.last_event_at ?? ""} rid={r.id} />
          </div>
        </td>
      </tr>
      {msg && !open && <tr><td colSpan={9}><p role="alert" className="font-medium text-destructive">{msg}</p></td></tr>}
    </tbody>
  );
}

export function NeedsReview({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => api.get("/api/needs-review"));
  return (
    <section aria-labelledby="nr-h" className="card mx-auto w-full max-w-4xl space-y-3">
      <h2 id="nr-h" className="text-base leading-6 font-semibold">Action needed{data ? ` (${data.length})` : ""}</h2>
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
