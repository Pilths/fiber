import type { components } from "@/api/schema";
import { ReservationCard } from "@/components/reservations/ReservationCard";

type Item = components["schemas"]["NeedsReviewItem"];

type NeedsReviewProps = { data: Item[] | null; error: boolean; onChanged: () => void };

export function NeedsReview({ data, error, onChanged }: NeedsReviewProps) {
  return (
    <section aria-labelledby="nr-h" className="card mx-auto w-full max-w-4xl space-y-3">
      <h2 id="nr-h" className="text-base leading-6 font-semibold">Action needed{data ? ` (${data.length})` : ""}</h2>
      {error && <p role="alert">Could not load the list.</p>}
      {data && data.length === 0 && <p>Nothing needs action.</p>}
      <div className="space-y-3">
        {data?.map((item: Item, index) => (
          <div key={`${item.kind}-${item.reservation.id}-${index}`} className="space-y-1">
            <p className="text-sm font-semibold">{item.detail}</p>
            <ul><ReservationCard reservation={item.reservation} onChanged={onChanged} /></ul>
          </div>
        ))}
      </div>
    </section>
  );
}
