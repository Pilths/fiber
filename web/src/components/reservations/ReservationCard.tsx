import { inputCls } from "@/lib/status";
import { ReservationHistory } from "@/components/reservations/ReservationHistory";
import { ReservationSummary } from "@/components/reservations/ReservationSummary";
import {
  lastRemarksLabel, type Me, type Mode, type Reservation, useReservationAction,
} from "@/components/reservations/reservation";

// Status is always text (and a symbol), never colour alone.
const STATUS_LABEL: Record<Reservation["status"], string> = {
  pending: "◔ Pending approval",
  approved: "▨ Approved",
  rejected: "✕ Rejected",
  withdrawn: "○ Withdrawn",
  ended: "○ Ended (released)",
};

const CONFIRM_WORD: Record<Exclude<Mode, null>, string> = {
  reject: "rejection",
  "decline-release": "decline",
  "request-release": "release request",
};

type Action = ReturnType<typeof useReservationAction>;

function ReleasePicker({ held, pick, onToggle }: {
  held: Reservation["cores"]; pick: Set<number>; onToggle: (coreId: number) => void;
}) {
  return (
    <fieldset className="text-sm">
      <legend className="font-medium">Cores to free (the rest stays reserved)</legend>
      {held.length === 0 && <p>No named cores; the whole count will be released.</p>}
      {held.map((core) => (
        <label key={core.core_id} className="mr-3 inline-flex items-center gap-1">
          <input type="checkbox" checked={pick.has(core.core_id)} onChange={() => onToggle(core.core_id)} />{" "}
          {core.segment}: {core.number}
        </label>
      ))}
    </fieldset>
  );
}

// Confirm and Cancel of the open form, or the actions this user may take on the reservation.
function CardButtons({ reservation, me, action, held }: {
  reservation: Reservation; me: Me; action: Action; held: Reservation["cores"];
}) {
  const { mode, busy, run } = action;
  if (mode) {
    const asksRemarks = mode === "reject" || mode === "decline-release";
    const nothingPicked = mode === "request-release" && held.length > 0 && action.pick.size === 0;
    const confirm = () => {
      run(mode, asksRemarks ? { remarks: action.remarks.trim() } : { cores: [...action.pick] });
    };
    return (
      <>
        <button type="button" className="btn btn-p btn-sm" disabled={busy || nothingPicked} onClick={confirm}>
          Confirm {CONFIRM_WORD[mode]}
        </button>
        <button type="button" className="btn btn-sm" onClick={action.cancel}>Cancel</button>
      </>
    );
  }
  const own = reservation.planner_id === me.id;
  const admin = me.role === "admin";
  const canRelease = (own || admin) && reservation.status === "approved" && reservation.awaiting !== "release";
  return (
    <>
      {own && reservation.status === "pending" && (
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run("withdraw")}>Withdraw</button>
      )}
      {canRelease && (
        <>
          {reservation.stale && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run("keep")}>Keep</button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => action.setMode("request-release")}>
            Request release
          </button>
        </>
      )}
    </>
  );
}

function awaitingText(reservation: Reservation) {
  if (reservation.awaiting === "approval") {
    return "Waiting for approval";
  }
  return "Release requested, waiting for an admin";
}

export function ReservationCard({ reservation, me, onChanged }: {
  reservation: Reservation; me: Me; onChanged: () => void;
}) {
  const action = useReservationAction(reservation.id, onChanged);
  const { mode, remarks, setRemarks, message } = action;
  const held = reservation.cores.filter((core) => core.held);
  const asksRemarks = mode === "reject" || mode === "decline-release";
  const toggle = (coreId: number) => {
    action.setPick((old) => {
      const next = new Set(old);
      if (!next.delete(coreId)) {
        next.add(coreId);
      }
      return next;
    });
  };
  const plannedText = reservation.planned_date ? `, planned ${reservation.planned_date}` : ", no planned date";

  return (
    <li className="space-y-2 rounded-xl border border-border bg-white p-4" data-testid="reservation">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          #{reservation.id} {reservation.customer}{reservation.is_new_customer && " (new customer)"}
        </h3>
        <span className="text-sm font-medium">{STATUS_LABEL[reservation.status]}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        Requested by {reservation.planner}{plannedText}
        {reservation.imported && ", imported"}. Last event: {reservation.last_event ?? "none"},{" "}
        {reservation.age_days} days ago.
      </p>
      {reservation.awaiting && (
        <p className="text-sm font-medium">{awaitingText(reservation)} for {reservation.age_days} days.</p>
      )}
      {reservation.stale && <p className="text-sm font-medium">Stale: no approval or keep for over 3 months.</p>}
      {reservation.last_remarks && (
        <p className="text-sm font-medium" role="note">
          {lastRemarksLabel(reservation)}: {reservation.last_remarks}
        </p>
      )}
      <ReservationSummary reservation={reservation} variant="card" />

      {mode === "request-release" && <ReleasePicker held={held} pick={action.pick} onToggle={toggle} />}
      {asksRemarks && (
        <label className="block text-sm font-medium">Remarks (optional)
          <input className={`${inputCls} mt-1 block w-full`} value={remarks}
            onChange={(event) => setRemarks(event.target.value)} />
        </label>
      )}
      {message && <p role="alert" className="text-sm font-medium text-destructive">{message}</p>}
      <ReservationHistory key={reservation.last_event_at ?? ""} reservationId={reservation.id} />

      <div className="flex flex-wrap gap-2">
        <CardButtons reservation={reservation} me={me} action={action} held={held} />
      </div>
    </li>
  );
}
