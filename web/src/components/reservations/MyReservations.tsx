import { useState } from "react";
import { api } from "@/api/client";
import { useLoad } from "@/lib/useLoad";
import { NeedsReview } from "@/components/reservations/NeedsReview";
import { ReservationCard } from "@/components/reservations/ReservationCard";
import type { Me, Reservation } from "@/components/reservations/reservation";

type Chip = "All" | "Action needed" | "Pending" | "Stale";

const CHIPS: Chip[] = ["All", "Action needed", "Pending", "Stale"];

const EMPTY_TEXT: Record<Chip, string> = {
  All: "No reservations.",
  "Action needed": "Nothing needs action.",
  Pending: "No pending reservations.",
  Stale: "No stale reservations.",
};

// Which of the planner's reservations each chip shows. Action needed = the ones in GET /api/needs-review.
function chipFilter(chip: Chip, needsAction: Set<number>): (reservation: Reservation) => boolean {
  if (chip === "Action needed") {
    return (reservation) => needsAction.has(reservation.id);
  }
  if (chip === "Pending") {
    return (reservation) => reservation.status === "pending";
  }
  if (chip === "Stale") {
    return (reservation) => reservation.stale;
  }
  return () => true;
}

// My reservations: loaded once, filtered on the client by chip. The needs-review list is loaded here too and
// shared with the Action needed section below, so it is fetched once. Only admins get that section: it lists
// every planner's items, while for a planner it would repeat the Action needed chip.
export function MyReservations({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [chip, setChip] = useState<Chip>("All");
  const mine = useLoad(() => api.get("/api/reservations", { query: { mine: true } }));
  const review = useLoad(() => api.get("/api/needs-review"));
  const needsAction = new Set((review.data ?? []).map((item) => item.reservation.id));
  const reloadAll = () => {
    mine.reload();
    review.reload();
    onChanged();
  };
  const countOf = (name: Chip) => (mine.data ?? []).filter(chipFilter(name, needsAction)).length;
  const shown = mine.data?.filter(chipFilter(chip, needsAction));
  return (
    <>
      <section aria-labelledby="mine-h" className="card mx-auto w-full max-w-4xl space-y-3">
        <h2 id="mine-h" className="text-base leading-6 font-semibold">My reservations</h2>
        <div role="group" aria-label="Filter reservations" className="flex gap-2">
          {CHIPS.map((name) => (
            <button key={name} type="button" className="chip" aria-pressed={chip === name} onClick={() => setChip(name)}>
              {name} {mine.data ? countOf(name) : ""}
            </button>
          ))}
        </div>
        {mine.error && <p role="alert">Could not load reservations.</p>}
        {shown && shown.length === 0 && <p>{EMPTY_TEXT[chip]}</p>}
        <ul className="space-y-3">
          {shown?.map((reservation) => (
            <ReservationCard key={reservation.id} reservation={reservation} onChanged={reloadAll} />
          ))}
        </ul>
      </section>
      {me.role === "admin" && (
        <NeedsReview data={review.data} error={review.error} onChanged={reloadAll} />
      )}
    </>
  );
}
