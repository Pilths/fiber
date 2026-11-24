import { Icon } from "@/components/Icon";
import { groupCores, type Reservation } from "@/components/reservations/reservation";

function coreNumbers(cores: Reservation["cores"]) {
  return cores.map((core) => (core.held ? core.number : `${core.number} (released)`)).join(", ");
}

function releaseRequestedText(reservation: Reservation) {
  const requested = reservation.cores.filter((core) => reservation.release_requested_cores.includes(core.core_id));
  if (requested.length === 0) {
    return `${reservation.remaining_unassigned} not assigned`;
  }
  return requested.map((core) => core.number).join(", ");
}

// Status chips of a reservation; each carries a word, never colour alone. Approvals leaves out the waiting chip
// (its Type column says it).
export function ReservationChips({ reservation, showWaiting = true }: {
  reservation: Reservation; showWaiting?: boolean;
}) {
  const waitingApproval = showWaiting && reservation.awaiting === "approval";
  const waitingRelease = showWaiting && reservation.awaiting === "release";
  if (!waitingApproval && !waitingRelease && !reservation.stale) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {waitingApproval && <span className="pill h-amber"><Icon name="rq" />Waiting approval</span>}
      {waitingRelease && <span className="pill h-blue"><Icon name="ex" />Release requested</span>}
      {reservation.stale && <span className="pill h-amber"><Icon name="lo" />Stale</span>}
    </div>
  );
}

// The core lines of a reservation: cores by count, named cores per segment and cores waiting for release.
// "card" (My reservations) uses small text and bold for the unassigned count; "row" (Approvals details) shows the
// release line whenever a release is awaited.
export function ReservationSummary({ reservation, variant }: { reservation: Reservation; variant: "card" | "row" }) {
  const card = variant === "card";
  const lineClass = card ? "text-sm" : undefined;
  const remaining = `${reservation.remaining_unassigned} not assigned`;
  const showRelease = card ? reservation.release_requested_cores.length > 0 : reservation.awaiting === "release";
  return (
    <>
      {reservation.unassigned_cores > 0 && (
        <p className={lineClass}>
          {reservation.unassigned_segment}: {reservation.unassigned_cores} by count ·{" "}
          {card ? <strong>{remaining}</strong> : remaining}
        </p>
      )}
      {groupCores(reservation).map(([segment, cores]) => (
        <p key={segment} className={lineClass}>{segment}: {coreNumbers(cores)}</p>
      ))}
      {showRelease && <p className={lineClass}>Release requested: {releaseRequestedText(reservation)}</p>}
    </>
  );
}
