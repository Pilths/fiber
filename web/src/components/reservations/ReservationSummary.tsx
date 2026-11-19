import { plural } from "@/lib/format";
import { groupCores, type Reservation } from "@/components/reservations/reservation";

function coreNumbers(cores: Reservation["cores"]) {
  return cores.map((core) => (core.held ? core.number : `${core.number} (released)`)).join(", ");
}

function releaseRequestedNumbers(reservation: Reservation) {
  const requested = reservation.cores.filter((core) => reservation.release_requested_cores.includes(core.core_id));
  return requested.map((core) => core.number).join(", ");
}

// The core lines of a reservation: cores by count, named cores per segment and cores waiting for release.
// "card" (My reservations) uses small text and bold for the unassigned count; "row" (Approvals details) shows the
// release line whenever a release is awaited and says "unassigned" when it names no cores.
export function ReservationSummary({ reservation, variant }: { reservation: Reservation; variant: "card" | "row" }) {
  const card = variant === "card";
  const lineClass = card ? "text-sm" : undefined;
  const remaining = `${reservation.remaining_unassigned} not assigned yet`;
  const showRelease = card ? reservation.release_requested_cores.length > 0 : reservation.awaiting === "release";
  const releaseNumbers = releaseRequestedNumbers(reservation);
  const releaseText = card ? releaseNumbers : releaseNumbers || "unassigned";
  return (
    <>
      {reservation.unassigned_cores > 0 && (
        <p className={lineClass}>
          {plural(reservation.unassigned_cores, "core")} reserved by count on {reservation.unassigned_segment};{" "}
          {card ? <strong>{remaining}</strong> : remaining}.
        </p>
      )}
      {groupCores(reservation).map(([segment, cores]) => (
        <p key={segment} className={lineClass}>{segment}: cores {coreNumbers(cores)}</p>
      ))}
      {showRelease && <p className={lineClass}>Release requested for cores {releaseText}.</p>}
    </>
  );
}
