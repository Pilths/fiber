import { useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { portLines } from "@/lib/portLabel";

export type PastePortsResult = components["schemas"]["PastePortsResult"];
export type PastePortRow = components["schemas"]["PastePortRow"];
type PastePortsBody = components["schemas"]["PastePortsBody"];

const PREVIEW_DELAY_MS = 400;

function readyCount(result: PastePortsResult | null): number {
  if (result == null) {
    return 0;
  }
  return result.counts.new + result.counts.replaces;
}

function inputKey(segmentId: number, startCore: string, portA: string, portB: string): string {
  return JSON.stringify([segmentId, startCore, portA, portB]);
}

function pasteBody(startCore: string, portA: string, portB: string, apply: boolean): PastePortsBody {
  return {
    start_core: Number(startCore) || 1,
    port_a: portLines(portA),
    port_b: portLines(portB),
    apply,
  };
}

// Paste ports: two textareas, a debounced preview (apply=false) and one Apply that writes the ready rows.
export function usePastePorts(segmentId: number, onApplied: () => void) {
  const [startCore, setStartCore] = useState("1");
  const [portA, setPortA] = useState("");
  const [portB, setPortB] = useState("");
  // The preview and the exact text it was made from.
  const [previewed, setPreviewed] = useState<{ key: string; result: PastePortsResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (portA === "" && portB === "") {
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const preview = await api.post("/api/admin/segments/{segment_id}/ports", {
          path: { segment_id: segmentId },
          body: pasteBody(startCore, portA, portB, false),
        });
        if (!stale) {
          setPreviewed({ key: inputKey(segmentId, startCore, portA, portB), result: preview });
          setError(null);
        }
      } catch (err) {
        if (!stale) {
          setError(errorText(err, "Could not check the ports. Try again."));
        }
      }
    }, PREVIEW_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [segmentId, startCore, portA, portB]);

  // A preview of text that was since cleared is not shown.
  const nothingPasted = portA === "" && portB === "";
  const shownResult = nothingPasted ? null : (previewed?.result ?? null);
  // Apply writes the text in the boxes, so it is offered only when the preview was made from that text.
  const previewIsCurrent = previewed?.key === inputKey(segmentId, startCore, portA, portB);
  const ready = previewIsCurrent ? readyCount(shownResult) : 0;

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/segments/{segment_id}/ports", {
        path: { segment_id: segmentId },
        body: pasteBody(startCore, portA, portB, true),
      });
      onApplied();
    } catch (err) {
      setError(errorText(err, "Could not save the ports. Try again."));
      setBusy(false);
    }
  };

  return {
    startCore,
    setStartCore,
    portA,
    setPortA,
    portB,
    setPortB,
    result: shownResult,
    ready,
    error,
    busy,
    apply,
  };
}
