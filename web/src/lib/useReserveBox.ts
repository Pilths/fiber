import { useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { useCustomerPicker } from "@/lib/useCustomerPicker";

export type Core = components["schemas"]["CoreDetail"];
export type LossDetail = components["schemas"]["SegmentLossDetail"];
export type LegData = { cores: Core[]; loss: LossDetail | null };
// a and b in travel order
export type RouteLeg = { segment_id: number; free: number; a: string; b: string; km: number | null };

export function availableCores(cores: Core[]): Core[] {
  const available = cores.filter((core) => core.status === "Available");
  return available.sort((first, second) => first.number - second.number);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

// Pick a segment in the chain and tick N of its Available cores, for every segment;
// one POST /api/reservations with the chosen core ids.
export function useReserveBox(
  legs: RouteLeg[],
  need: number,
  onClose: () => void,
  onSent: (id: number) => void,
) {
  const max = Math.min(...legs.map((leg) => leg.free));
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [perSegment, setPerSegment] = useState(clamp(need, 1, max));
  // The selected segment and each segment's cores and loss, fetched on its first select.
  const [picked, setPicked] = useState<number | null>(null);
  const [legData, setLegData] = useState<Record<number, LegData>>({});
  const [date, setDate] = useState("");
  const [srf, setSrf] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const customerPicker = useCustomerPicker(setError);

  const chosenOn = (segmentId: number) => {
    const cores = legData[segmentId]?.cores ?? [];
    return cores.filter((core) => ticked.has(core.id)).length;
  };
  const ready = legs.every((leg) => chosenOn(leg.segment_id) === perSegment);

  const loadLeg = async (segmentId: number) => {
    try {
      const path = { path: { segment_id: segmentId } };
      const [detail, loss] = await Promise.all([
        api.get("/api/segments/{segment_id}", path),
        api.get("/api/loss/segments/{segment_id}", path).catch(() => null),
      ]);
      setLegData((current) => ({ ...current, [segmentId]: { cores: detail.cores, loss } }));
    } catch (caught) {
      setError(errorText(caught, "Could not load the cores. Try again."));
    }
  };

  const pick = (segmentId: number) => {
    setPicked(segmentId);
    if (!legData[segmentId]) {
      loadLeg(segmentId);
    }
  };

  // Closing with ticked cores asks first.
  const close = () => {
    if (ticked.size) {
      setAsking(true);
      return;
    }
    onClose();
  };

  const step = (to: number) => setPerSegment(clamp(to, 1, max));

  const toggle = (coreId: number) => {
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(coreId)) {
        next.add(coreId);
      }
      return next;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!customerPicker.customer || !ready) {
      return;
    }
    setBusy(true);
    setError(null);
    const srfId = srf.trim();
    const body = {
      customer_id: customerPicker.customer.id,
      planned_date: date || null,
      ...(srfId && { srf_id: srfId }),
      cores: [...ticked],
    };
    try {
      const created = await api.post("/api/reservations", { body });
      onSent(created.id);
      onClose();
    } catch (caught) {
      setError(errorText(caught, "Submit failed. Try again."));
      setBusy(false);
    }
  };

  const shown = picked == null ? null : legData[picked];
  return {
    max,
    perSegment,
    step,
    ticked,
    toggle,
    picked,
    pick,
    unpick: () => setPicked(null),
    shown,
    chosenOn,
    ready,
    date,
    setDate,
    srf,
    setSrf,
    tried,
    busy,
    error,
    asking,
    setAsking,
    close,
    submit,
    customerPicker,
  };
}

export type ReserveBoxState = ReturnType<typeof useReserveBox>;
