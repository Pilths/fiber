import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { CoreTable } from "@/components/CoreTable";
import { Header, type View } from "@/components/Header";
import { Approvals, MyReservations, NeedsReview } from "@/components/Reservations";
import { PortGrid } from "@/components/PortGrid";
import { ReservePanel } from "@/components/ReservePanel";
import { SpanList } from "@/components/SpanList";
import { Button } from "@/components/ui/button";

type Span = components["schemas"]["SpanSummary"];
type Detail = components["schemas"]["SpanDetail"];
type Me = components["schemas"]["CurrentUser"];
type Bell = components["schemas"]["Bell"];

export default function App() {
  const [spans, setSpans] = useState<Span[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spanId, setSpanId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [focusCoreId, setFocusCoreId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reserving, setReserving] = useState(false);
  const [view, setView] = useState<View>("spans");
  const [me, setMe] = useState<Me | null>(null);
  const [bell, setBell] = useState<Bell | null>(null);
  const [version, setVersion] = useState(0); // bumped after a booking so the span list and grid reload

  const refreshBell = useCallback(() => {
    api.get("/api/bell").then(setBell).catch(() => {});
  }, []);
  useEffect(() => {
    api.get("/api/me").then(setMe).catch(() => setError("Could not sign in."));
  }, []);
  useEffect(refreshBell, [refreshBell, view]);

  useEffect(() => {
    api.get("/api/spans").then(setSpans).catch(() => setError("Could not load spans."));
  }, [version, view]);

  useEffect(() => {
    if (spanId == null) return;
    let stale = false;
    api.get("/api/spans/{span_id}", { path: { span_id: spanId } }).then((d) => !stale && setDetail(d)).catch(() => !stale && setError("Could not load the span."));
    return () => { stale = true; };
  }, [spanId, version, view]);

  const open = useCallback((id: number, coreId: number | null = null) => {
    setView("spans");
    setDetail((d) => (d?.id === id ? d : null));
    setSpanId(id);
    setFocusCoreId(coreId);
    setSelected(new Set());
  }, []);
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const chosen = detail?.cores.filter((c) => selected.has(c.id)) ?? [];

  const surveyed = detail?.survey_cores != null;

  return (
    <div className="min-h-screen">
      <Header onPick={(r) => r.span_id != null && open(r.span_id, r.core_id ?? null)} view={view} onView={setView} me={me} bell={bell} />
      {error && <p role="alert" className="p-4">{error}</p>}
      {view !== "spans" && me && (
        <main className="p-4">
          {view === "mine" && <MyReservations me={me} onChanged={refreshBell} />}
          {view === "approvals" && <Approvals me={me} onChanged={refreshBell} />}
          {view === "review" && <NeedsReview me={me} onChanged={refreshBell} />}
        </main>
      )}
      {view === "spans" && (
      <main className="grid gap-6 p-4 lg:grid-cols-[22rem_1fr]">
        {spans ? <SpanList spans={spans} selectedId={spanId} onSelect={(id) => open(id)} /> : <p>Loading spans...</p>}
        <section aria-labelledby="detail-h" className="min-w-0 space-y-4">
          {spanId == null && <p id="detail-h" className="text-muted-foreground">Pick a span, or search above, to see its port grid.</p>}
          {spanId != null && !detail && <p id="detail-h">Loading span...</p>}
          {detail && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="detail-h" className="text-lg font-semibold">{detail.site_a} - {detail.site_b}</h2>
                <Button onClick={() => setReserving(true)} disabled={!surveyed}>Reserve cores ({chosen.length} selected)</Button>
              </div>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="capacity">
                {surveyed ? (
                  <>
                    <span>Surveyed {detail.survey_cores} of cable {detail.cable_size}</span>
                    {detail.unassigned_reserved > 0 && <span>+{detail.unassigned_reserved} reserved, not assigned</span>}
                    <strong>Free to reserve {detail.free_to_reserve}</strong>
                  </>
                ) : (
                  <span role="status">Not surveyed yet: this span has no cores to show and cannot be booked. Cable size {detail.cable_size}.</span>
                )}
              </p>
              {surveyed && <PortGrid cores={detail.cores} selected={selected} onToggle={toggle} focusCoreId={focusCoreId} />}
              {surveyed && <CoreTable cores={detail.cores} />}
            </>
          )}
        </section>
      </main>
      )}
      {reserving && detail && (
        <ReservePanel
          spanLabel={`${detail.site_a} - ${detail.site_b}`}
          cores={chosen.map((c) => ({ id: c.id, number: c.number }))}
          onClose={() => setReserving(false)}
          onDone={() => { setSelected(new Set()); setVersion((v) => v + 1); refreshBell(); }}
        />
      )}
    </div>
  );
}
