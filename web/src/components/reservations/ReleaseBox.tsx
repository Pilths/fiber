import { useState } from "react";
import { Dialog } from "@/components/upload-parts";
import { plural } from "@/lib/format";
import { groupCores, type Reservation, useReservationAction } from "@/components/reservations/reservation";

type Group = { segment: string; cores: Reservation["cores"] };

// Held cores by segment (released cores are left out). The count-only part's segment gets a group even when it
// holds no named core, so its "N not assigned" line has a place.
function heldGroups(reservation: Reservation): Group[] {
  const groups = groupCores(reservation)
    .map(([segment, cores]) => ({ segment, cores: cores.filter((core) => core.held) }))
    .filter((group) => group.cores.length > 0);
  const countSegment = reservation.unassigned_segment;
  const hasCount = reservation.remaining_unassigned > 0 && countSegment;
  if (hasCount && !groups.some((group) => group.segment === countSegment)) {
    groups.push({ segment: countSegment, cores: [] });
  }
  return groups;
}

function startTicked(reservation: Reservation): Set<number> {
  if (reservation.awaiting !== "release") {
    return new Set();
  }
  const held = reservation.cores.filter((core) => core.held).map((core) => core.core_id);
  return new Set(held.filter((coreId) => reservation.release_requested_cores.includes(coreId)));
}

// "A - B: 13, 14" for each segment with unticked held cores.
function staysHeldLines(groups: Group[], ticked: Set<number>): string[] {
  const lines: string[] = [];
  for (const group of groups) {
    const unticked = group.cores.filter((core) => !ticked.has(core.core_id));
    if (unticked.length > 0) {
      lines.push(`${group.segment}: ${unticked.map((core) => core.number).join(", ")}`);
    }
  }
  return lines;
}

// The only way an admin releases (Approvals, the reservation card, the core drawer). Requested cores start ticked
// when a release is waiting. A count-only reservation has one tick box for its count and sends `cores: []`; when it
// also holds named cores the count ends with the last of them, so it is shown read-only.
export function ReleaseBox({ reservation, onClose, onChanged }: {
  reservation: Reservation; onClose: () => void; onChanged: () => void;
}) {
  const done = () => {
    onChanged();
    onClose();
  };
  const action = useReservationAction(reservation.id, done);
  const [ticked, setTicked] = useState(() => startTicked(reservation));
  const waiting = reservation.awaiting === "release";
  const [countTicked, setCountTicked] = useState(waiting);
  const groups = heldGroups(reservation);
  const heldCount = groups.reduce((total, group) => total + group.cores.length, 0);
  const remaining = reservation.remaining_unassigned;
  const countOnly = heldCount === 0;
  const allTicked = heldCount > 0 && ticked.size === heldCount;
  const staysHeld = staysHeldLines(groups, ticked);
  if (!countOnly && remaining > 0 && !allTicked) {
    staysHeld.push(`${reservation.unassigned_segment}: ${remaining} not assigned`);
  }
  let releaseCount = ticked.size;
  if (countOnly) {
    releaseCount = countTicked ? remaining : 0;
  }
  const nothingTicked = countOnly ? !countTicked : ticked.size === 0;

  const toggle = (coreId: number) => {
    setTicked((old) => {
      const next = new Set(old);
      if (!next.delete(coreId)) {
        next.add(coreId);
      }
      return next;
    });
  };
  const confirm = () => {
    const cores = countOnly ? [] : [...ticked];
    action.run("release", { cores });
  };

  return (
    <Dialog title={`#${reservation.id} ${reservation.customer}`} onClose={onClose} wide>
      <div className="mt-3 space-y-3 text-body" data-testid="release-box">
        {!waiting && <p className="font-medium">No request</p>}
        {reservation.release_request_remarks && <p>Remarks: {reservation.release_request_remarks}</p>}
        {groups.map((group) => (
          <fieldset key={group.segment}>
            <legend className="font-semibold">{group.segment}</legend>
            {group.cores.map((core) => (
              <label key={core.core_id} className="mr-4 inline-flex items-center gap-1">
                <input type="checkbox" checked={ticked.has(core.core_id)} onChange={() => toggle(core.core_id)} />
                {core.number}
              </label>
            ))}
            {remaining > 0 && group.segment === reservation.unassigned_segment && (
              <CountLine remaining={remaining} countOnly={countOnly} checked={countTicked}
                onToggle={() => setCountTicked((old) => !old)} />
            )}
          </fieldset>
        ))}
        <div className="border-t pt-3">
          <p className="font-semibold">Release: {plural(releaseCount, "core")}</p>
          {allTicked && remaining > 0 && (
            <p>Also ends: {remaining} not assigned, {reservation.unassigned_segment}</p>
          )}
          {staysHeld.length > 0 && (
            <div data-testid="stays-held">
              <p className="font-semibold">Stays held:</p>
              {staysHeld.map((line) => <p key={line}>{line}</p>)}
            </div>
          )}
        </div>
        {action.message && <p role="alert" className="font-medium text-destructive">{action.message}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn btn-p" disabled={action.busy || nothingTicked} onClick={confirm}>
            Confirm release
          </button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}

function CountLine({ remaining, countOnly, checked, onToggle }: {
  remaining: number; countOnly: boolean; checked: boolean; onToggle: () => void;
}) {
  const text = `${remaining} not assigned`;
  if (!countOnly) {
    return <p>{text}</p>;
  }
  return (
    <label className="inline-flex items-center gap-1">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      {text}
    </label>
  );
}
