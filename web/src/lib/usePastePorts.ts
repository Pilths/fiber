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
  const [result, setResult] = useState<PastePortsResult | null>(null);
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
          setResult(preview);
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
  const shownResult = nothingPasted ? null : result;

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
    ready: readyCount(shownResult),
    error,
    busy,
    apply,
  };
}
