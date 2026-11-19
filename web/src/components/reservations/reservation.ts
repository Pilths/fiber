import { useState } from "react";
import { errorText, resAction, type Action } from "@/api/client";
import type { components } from "@/api/schema";

export type Reservation = components["schemas"]["ReservationOut"];
export type Me = components["schemas"]["CurrentUser"];

// The open form of one reservation: reject or decline-release ask for remarks, request-release for cores.
export type Mode = "reject" | "decline-release" | "request-release" | null;

// The reservation's named cores grouped by segment, in order of first appearance.
export function groupCores(reservation: Reservation) {
  const bySegment = new Map<string, Reservation["cores"]>();
  for (const core of reservation.cores) {
    bySegment.set(core.segment, [...(bySegment.get(core.segment) ?? []), core]);
  }
  return [...bySegment.entries()];
}

export function lastRemarksLabel(reservation: Reservation) {
  return reservation.status === "rejected" ? "Rejection remarks" : "Release declined remarks";
}

// One reservation's actions: run an action, then reset the open form and tell the parent to reload.
export function useReservationAction(reservationId: number, onChanged: () => void) {
  const [mode, setMode] = useState<Mode>(null);
  const [remarks, setRemarks] = useState("");
  const [pick, setPick] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: Action, body?: { remarks?: string; cores?: number[] }) => {
    setBusy(true);
    setMessage(null);
    try {
      await resAction(reservationId, action, body);
      setMode(null);
      setRemarks("");
      setPick(new Set());
      onChanged();
    } catch (err) {
      setMessage(errorText(err, "Action failed. Try again."));
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    setMode(null);
    setMessage(null);
  };
  return { mode, setMode, remarks, setRemarks, pick, setPick, message, setMessage, busy, run, cancel };
}
