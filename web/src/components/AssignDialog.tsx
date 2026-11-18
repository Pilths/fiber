import { useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { Dialog } from "@/components/upload-parts";

type Detail = components["schemas"]["SegmentDetail"];
type Hold = components["schemas"]["UnassignedHold"];

const CORE_BUTTON = "flex h-9 items-center justify-center gap-0.5 rounded-md border text-sm font-semibold "
  + "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue "
  + "disabled:cursor-not-allowed disabled:opacity-40";
const CORE_ON = "border-[#0f3a78] bg-blue text-white";
const CORE_OFF = "border-line bg-white hover:border-foreground";

function assignLabel(count: number) {
  if (count === 0) {
    return "Assign cores";
  }
  return `Assign ${count} ${count === 1 ? "core" : "cores"}`;
}

// Admin names specific Available cores for part or all of a count-only reservation (an 'assigned' event).
export function AssignDialog({ d: detail, hold, onClose, onSaved }: {
  d: Detail; hold: Hold; onClose: () => void; onSaved: () => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const free = detail.cores.filter((core) => core.status === "Available");
  const full = picked.size >= hold.remaining;
  const toggle = (id: number) => {
    setPicked((old) => {
      const next = new Set(old);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = { rid: hold.reservation_id };
      await api.post("/api/reservations/{rid}/assign", { path, body: { cores: [...picked] } });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not assign. Try again."));
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Assign cores to ${hold.customer ?? `reservation #${hold.reservation_id}`}`} onClose={onClose} wide>
      <p className="mt-2 text-body text-muted-foreground">
        Reservation #{hold.reservation_id}, {hold.remaining} unassigned. Choose up to {hold.remaining}.{" "}
        <b className="font-semibold text-foreground">{picked.size} chosen</b>.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">
          {error}
        </p>
      )}
      <form onSubmit={submit} noValidate aria-label="Assign cores">
        {free.length === 0 ? (
          <p className="mt-4 text-body text-muted-foreground">No Available cores on this segment.</p>
        ) : (
          <div role="group" aria-label="Available cores"
            className="mt-4 grid max-h-[50vh] grid-cols-12 gap-1 overflow-y-auto">
            {free.map((core) => {
              const on = picked.has(core.id);
              return (
                <button key={core.id} type="button" aria-pressed={on} aria-label={`Core ${core.number}`}
                  disabled={!on && full} onClick={() => toggle(core.id)}
                  className={`${CORE_BUTTON} ${on ? CORE_ON : CORE_OFF}`}>
                  {on && <Icon name="ch" />}{core.number}
                </button>
              );
            })}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-p" disabled={busy || !picked.size}>
            {busy ? "Assigning…" : assignLabel(picked.size)}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
