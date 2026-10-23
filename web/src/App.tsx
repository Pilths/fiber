import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { CoreTable } from "@/components/CoreTable";
import { Header } from "@/components/Header";
import { PortGrid } from "@/components/PortGrid";
import { ReservePanel } from "@/components/ReservePanel";
import { SpanList } from "@/components/SpanList";
import { Button } from "@/components/ui/button";

type Span = components["schemas"]["SpanSummary"];
type Detail = components["schemas"]["SpanDetail"];

export default function App() {
  const [spans, setSpans] = useState<Span[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spanId, setSpanId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [focusCoreId, setFocusCoreId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reserving, setReserving] = useState(false);

  useEffect(() => {
    api.get("/api/spans").then(setSpans).catch(() => setError("Could not load spans."));
  }, []);

  useEffect(() => {
    if (spanId == null) return;
    let stale = false;
    setDetail(null);
    api.get("/api/spans/{span_id}", { path: { span_id: spanId } }).then((d) => !stale && setDetail(d)).catch(() => !stale && setError("Could not load the span."));
    return () => { stale = true; };
  }, [spanId]);

  const open = useCallback((id: number, coreId: number | null = null) => {
    setSpanId(id);
    setFocusCoreId(coreId);
    setSelected(new Set());
  }, []);
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const chosen = detail?.cores.filter((c) => selected.has(c.id)) ?? [];

  return (
    <div className="min-h-screen">
      <Header onPick={(r) => r.span_id != null && open(r.span_id, r.core_id ?? null)} />
      <main className="grid gap-6 p-4 lg:grid-cols-[22rem_1fr]">
        {error && <p role="alert" className="lg:col-span-2">{error}</p>}
        {spans ? <SpanList spans={spans} selectedId={spanId} onSelect={(id) => open(id)} /> : <p>Loading spans...</p>}
        <section aria-labelledby="detail-h" className="min-w-0 space-y-4">
          {spanId == null && <p id="detail-h" className="text-muted-foreground">Pick a span, or search above, to see its port grid.</p>}
          {spanId != null && !detail && <p id="detail-h">Loading span...</p>}
          {detail && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="detail-h" className="text-lg font-semibold">{detail.site_a} - {detail.site_b}</h2>
                <Button onClick={() => setReserving(true)}>Reserve cores ({chosen.length} selected)</Button>
              </div>
              <PortGrid cores={detail.cores} selected={selected} onToggle={toggle} focusCoreId={focusCoreId} />
              <CoreTable cores={detail.cores} />
            </>
          )}
        </section>
      </main>
      {reserving && detail && (
        <ReservePanel
          spanLabel={`${detail.site_a} - ${detail.site_b}`}
          cores={chosen.map((c) => ({ id: c.id, number: c.number }))}
          onClose={() => setReserving(false)}
          onDone={() => {}}
        />
      )}
    </div>
  );
}
