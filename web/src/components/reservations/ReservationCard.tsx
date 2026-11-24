import { useState } from "react";
import { inputCls } from "@/lib/status";
import { ReleaseBox } from "@/components/reservations/ReleaseBox";
import { ReservationHistory } from "@/components/reservations/ReservationHistory";
import { ReservationChips, ReservationSummary } from "@/components/reservations/ReservationSummary";
import {
  lastEventText, lastRemarksLabel, type Mode, type Reservation, useReservationAction,
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

function ReleasePicker({ reservation, held, pick, onToggle }: {
  reservation: Reservation; held: Reservation["cores"]; pick: Set<number>; onToggle: (coreId: number) => void;
}) {
  return (
    <fieldset className="text-sm">
      <legend className="font-medium">Cores to free</legend>
      {held.length === 0 && <p>{reservation.remaining_unassigned} not assigned</p>}
      {held.map((core) => (
        <label key={core.core_id} className="mr-3 inline-flex items-center gap-1">
          <input type="checkbox" checked={pick.has(core.core_id)} onChange={() => onToggle(core.core_id)} />{" "}
          {core.segment}: {core.number}
        </label>
      ))}
    </fieldset>
  );
}

// Confirm and Cancel of the open form, or the actions the API allows this user on the reservation.
function CardButtons({ reservation, action, held, onRelease }: {
  reservation: Reservation; action: Action; held: Reservation["cores"]; onRelease: () => void;
}) {
  const { mode, busy, run } = action;
  if (mode) {
    const asksCores = mode === "request-release";
    const nothingPicked = asksCores && held.length > 0 && action.pick.size === 0;
    const confirm = () => {
      const remarks = action.remarks.trim();
      if (asksCores) {
        run(mode, { cores: [...action.pick], remarks });
        return;
      }
      run(mode, { remarks });
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
  const allows = (name: string) => reservation.actions.includes(name);
  return (
    <>
      {allows("withdraw") && (
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run("withdraw")}>Withdraw</button>
      )}
      {allows("keep") && (
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run("keep")}>Keep</button>
      )}
      {allows("request-release") && (
        <button type="button" className="btn btn-sm" onClick={() => action.setMode("request-release")}>
          Request release
        </button>
      )}
      {allows("release") && <button type="button" className="btn btn-sm" onClick={onRelease}>Release</button>}
    </>
  );
}

// "Planner X · Planned 2026-12-01 · Imported · Last Approved · 12 d"
function metaText(reservation: Reservation) {
  const parts = [`Planner ${reservation.planner}`, `Planned ${reservation.planned_date ?? "-"}`];
  if (reservation.imported) {
    parts.push("Imported");
  }
  parts.push(lastEventText(reservation));
  return parts.join(" · ");
}

export function ReservationCard({ reservation, onChanged }: { reservation: Reservation; onChanged: () => void }) {
  const action = useReservationAction(reservation.id, onChanged);
  const [releasing, setReleasing] = useState(false);
  const { mode, remarks, setRemarks, message } = action;
  const held = reservation.cores.filter((core) => core.held);
  const toggle = (coreId: number) => {
    action.setPick((old) => {
      const next = new Set(old);
      if (!next.delete(coreId)) {
        next.add(coreId);
      }
      return next;
    });
  };

  return (
    <li className="space-y-2 rounded-xl border border-border bg-white p-4" data-testid="reservation">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          #{reservation.id} {reservation.customer}{reservation.is_new_customer && " (new customer)"}
        </h3>
        <span className="text-sm font-medium">{STATUS_LABEL[reservation.status]}</span>
      </div>
      <p className="text-sm text-muted-foreground">{metaText(reservation)}</p>
      <ReservationChips reservation={reservation} />
      {reservation.last_remarks && (
        <p className="text-sm font-medium" role="note">
          {lastRemarksLabel(reservation)}: {reservation.last_remarks}
        </p>
      )}
      <ReservationSummary reservation={reservation} variant="card" />

      {mode === "request-release" && (
        <ReleasePicker reservation={reservation} held={held} pick={action.pick} onToggle={toggle} />
      )}
      {mode && (
        <label className="block text-sm font-medium">Remarks (optional)
          <input className={`${inputCls} mt-1 block w-full`} value={remarks}
            onChange={(event) => setRemarks(event.target.value)} />
        </label>
      )}
      {message && <p role="alert" className="text-sm font-medium text-destructive">{message}</p>}
      <ReservationHistory key={reservation.last_event_at ?? ""} reservationId={reservation.id} />

      <div className="flex flex-wrap gap-2">
        <CardButtons reservation={reservation} action={action} held={held} onRelease={() => setReleasing(true)} />
      </div>
      {releasing && (
        <ReleaseBox reservation={reservation} onClose={() => setReleasing(false)} onChanged={onChanged} />
      )}
    </li>
  );
}
