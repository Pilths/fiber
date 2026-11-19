import { useState } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { formatDateTime, plural } from "@/lib/format";
import { EVENT_WORD } from "@/lib/status";

type Event = components["schemas"]["EventOut"];

function countChangeText(change: number) {
  if (change > 0) {
    return `${plural(change, "core")} by count`;
  }
  return `${-change} assigned`;
}

function EventLine({ event }: { event: Event }) {
  const nowParts = [event.customer, event.planned_date && `planned ${event.planned_date}`].filter(Boolean);
  return (
    <li className="py-1">
      <span className="font-semibold">{EVENT_WORD[event.type] ?? event.type}</span> by {event.user}
      <span className="text-muted-foreground">, {formatDateTime(event.at)}</span>
      {event.cores.length > 0 && <span>; cores {event.cores.map((core) => core.number).join(", ")}</span>}
      {event.unassigned_change != null && <span>; {countChangeText(event.unassigned_change)}</span>}
      {(event.customer || event.planned_date) && <span>; now {nowParts.join(", ")}</span>}
      {event.remarks && <span className="block text-muted-foreground">Remarks: {event.remarks}</span>}
    </li>
  );
}

function HistoryBody({ events, error }: { events: Event[] | null; error: boolean }) {
  if (error) {
    return <p role="alert" className="mt-2 text-red">Could not load the history.</p>;
  }
  if (!events) {
    return <p className="mt-2 text-muted-foreground">Loading…</p>;
  }
  return (
    <ol className="mt-2 border-l-2 border-rule pl-3">
      {events.map((event) => <EventLine key={event.id} event={event} />)}
    </ol>
  );
}

// "History" disclosure: the reservation's events in order, loaded on first open.
export function ReservationHistory({ reservationId }: { reservationId: number }) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState(false);
  const load = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) {
      return;
    }
    api.get("/api/reservations/{reservation_id}/history", { path: { reservation_id: reservationId } })
      .then((loaded) => {
        setEvents(loaded);
        setError(false);
      })
      .catch(() => setError(true));
  };
  return (
    <details className="text-sm" onToggle={load} data-testid="res-history">
      <summary className="w-fit cursor-pointer font-semibold text-blue underline underline-offset-2">History</summary>
      <HistoryBody events={events} error={error} />
    </details>
  );
}
