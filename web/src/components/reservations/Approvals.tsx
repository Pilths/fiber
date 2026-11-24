import { useState } from "react";
import { api } from "@/api/client";
import { Icon } from "@/components/Icon";
import { useLoad } from "@/lib/useLoad";
import { ReservationHistory } from "@/components/reservations/ReservationHistory";
import { ReleaseBox } from "@/components/reservations/ReleaseBox";
import { ReservationChips, ReservationSummary } from "@/components/reservations/ReservationSummary";
import {
  groupCores, lastEventText, lastRemarksLabel, type Me, type Mode, type Reservation, useReservationAction,
} from "@/components/reservations/reservation";
import { formatDate } from "@/lib/format";

// Segment or route of a request: one segment name, or the first segment and how many more (all of them in the
// details row).
function segmentText(reservation: Reservation) {
  const segments = groupCores(reservation).map(([segment]) => segment);
  if (!segments.length) {
    return reservation.unassigned_segment ?? "—";
  }
  return segments.length === 1 ? segments[0] : `${segments[0]} +${segments.length - 1} more`;
}

// Approvals (admin): one table of waiting requests, oldest first. Approve / Reject (or Release / Decline for a release
// request) sit at the right of each row; Reject and Decline open the row to ask for remarks, Release opens the
// Release box. The chevron opens the row for its cores, notes and history.
export function Approvals({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => api.get("/api/approvals"));
  // Opened outside the table, so the box does not take the table's cell styles.
  const [releasing, setReleasing] = useState<Reservation | null>(null);
  const rowChanged = () => {
    reload();
    onChanged();
  };
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
            <ApprovalsHead />
            {data.map((reservation) => (
              <ApprovalRow key={reservation.id} reservation={reservation} onChanged={rowChanged}
                onRelease={setReleasing} />
            ))}
          </table>
        </div>
      )}
      {releasing && (
        <ReleaseBox reservation={releasing} onClose={() => setReleasing(null)} onChanged={rowChanged} />
      )}
    </section>
  );
}

function ApprovalsHead() {
  return (
    <thead><tr>
      <th scope="col" className="w-12"><span className="sr-only">Details</span></th>
      <th scope="col" className="w-[140px]">Requested</th>
      <th scope="col" className="w-20">Type</th>
      <th scope="col">Planner</th>
      <th scope="col">Customer</th>
      <th scope="col">Segment or route</th>
      <th scope="col" className="num w-24">Cores</th>
      <th scope="col" className="w-28">Planned</th>
      <th scope="col" className="w-[200px]"><span className="sr-only">Actions</span></th>
    </tr></thead>
  );
}

type Action = ReturnType<typeof useReservationAction>;

// The buttons the API allows: Approve / Reject on a new request, Release / Decline on a release request.
function RowButtons({ reservation, action, onAsk, onRelease }: {
  reservation: Reservation; action: Action; onAsk: (mode: Mode) => void; onRelease: () => void;
}) {
  const allows = (name: string) => reservation.actions.includes(name);
  return (
    <>
      {allows("approve") && (
        <button type="button" className="btn btn-p btn-sm" disabled={action.busy} onClick={() => action.run("approve")}>
          Approve
        </button>
      )}
      {allows("reject") && <button type="button" className="btn btn-sm" onClick={() => onAsk("reject")}>Reject</button>}
      {allows("release") && <button type="button" className="btn btn-sm" onClick={onRelease}>Release</button>}
      {allows("decline-release") && (
        <button type="button" className="btn btn-sm" onClick={() => onAsk("decline-release")}>Decline</button>
      )}
    </>
  );
}

function RemarksForm({ action }: { action: Action }) {
  const { mode, remarks, setRemarks, busy, run } = action;
  if (!mode) {
    return null;
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    run(mode, { remarks: remarks.trim() });
  };
  return (
    <form className="flex items-end gap-2 pt-1" onSubmit={submit}>
      <label className="w-[420px] font-medium">Remarks (optional)
        <input className="field mt-1 bg-white" value={remarks} onChange={(event) => setRemarks(event.target.value)}
          autoFocus />
      </label>
      <button type="submit" className="btn btn-p" disabled={busy}>
        Confirm {mode === "reject" ? "rejection" : "decline"}
      </button>
      <button type="button" className="btn" onClick={action.cancel}>Cancel</button>
    </form>
  );
}

// "#12 · Imported · Last Approved · 12 d"
function detailsText(reservation: Reservation) {
  const parts = [`#${reservation.id}`];
  if (reservation.imported) {
    parts.push("Imported");
  }
  parts.push(lastEventText(reservation));
  return parts.join(" · ");
}

function ApprovalDetails({ reservation, action }: { reservation: Reservation; action: Action }) {
  const message = action.message;
  return (
    <div className="space-y-1.5 text-body">
      <p className="text-muted-foreground">{detailsText(reservation)}</p>
      <ReservationChips reservation={reservation} showWaiting={false} />
      <ReservationSummary reservation={reservation} variant="row" />
      {reservation.last_remarks && <p role="note">{lastRemarksLabel(reservation)}: {reservation.last_remarks}</p>}
      <RemarksForm action={action} />
      {message && <p role="alert" className="font-medium text-destructive">{message}</p>}
      <ReservationHistory key={reservation.last_event_at ?? ""} reservationId={reservation.id} />
    </div>
  );
}

function ApprovalRow({ reservation, onChanged, onRelease }: {
  reservation: Reservation; onChanged: () => void; onRelease: (reservation: Reservation) => void;
}) {
  const action = useReservationAction(reservation.id, onChanged);
  const [open, setOpen] = useState(false);
  const release = reservation.awaiting === "release";
  const cores = release
    ? reservation.release_requested_cores.length
    : reservation.cores.length + reservation.unassigned_cores;
  const detailId = `appr-d-${reservation.id}`;
  const allSegments = groupCores(reservation).map(([segment]) => segment).join(", ");
  const ask = (mode: Mode) => {
    action.setMode(mode);
    action.setRemarks("");
    action.setMessage(null);
    setOpen(true);
  };
  return (
    <tbody data-testid="approval" className="border-b border-rule last:border-b-0 [&>tr>*]:border-b-0!">
      <tr className={open ? "bg-subtle" : ""}>
        <td>
          <button type="button" className="grid size-7 place-items-center rounded-md hover:bg-rule"
            aria-expanded={open} aria-controls={detailId} aria-label={`Details of request #${reservation.id}`}
            onClick={() => setOpen((wasOpen) => !wasOpen)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"
              className={`ni size-3.5! transition-transform ${open ? "rotate-90" : ""}`}><path d="M6 4l4 4-4 4" /></svg>
          </button>
        </td>
        <td>
          {formatDate(reservation.last_event_at)} <span className="text-muted-foreground">· {reservation.age_days} d</span>
        </td>
        <td>{release ? "Release" : "New"}</td>
        <td>{reservation.planner}</td>
        <th scope="row" className="font-semibold">
          {reservation.customer}
          {reservation.is_new_customer && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-amber">
              <Icon name="lo" />New customer
            </span>
          )}
        </th>
        <td className="truncate" title={allSegments || undefined}>{segmentText(reservation)}</td>
        <td className="num">
          {cores}
          {!release && reservation.unassigned_cores > 0 && <span className="text-muted-foreground"> by count</span>}
        </td>
        <td>{reservation.planned_date ?? "—"}</td>
        <td>
          <span className="inline-flex gap-2">
            <RowButtons reservation={reservation} action={action} onAsk={ask}
              onRelease={() => onRelease(reservation)} />
          </span>
        </td>
      </tr>
      <tr id={detailId} hidden={!open} className="bg-subtle">
        <td />
        <td colSpan={8} className="h-auto! py-3! whitespace-normal!">
          <ApprovalDetails reservation={reservation} action={action} />
        </td>
      </tr>
      {action.message && !open && (
        <tr><td colSpan={9}><p role="alert" className="font-medium text-destructive">{action.message}</p></td></tr>
      )}
    </tbody>
  );
}
