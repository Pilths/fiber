import { useMemo, useState } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { plural } from "@/lib/mapLayers";

// Customer mode on the map: a customer picked in the header search highlights only its segments,
// and their chips show the cores it uses (Reserved + In service) instead of free cores.
// The request picker narrows that to one request of the customer; null means all requests.
type Usage = components["schemas"]["CustomerUsage"];
export type CustomerRequest = Usage["reservations"][number];

export type CustomerHighlight = {
  id: number;
  name: string;
  requests: CustomerRequest[];
  request: CustomerRequest | null;
  used: Map<number, number>; // segment id -> used cores, of the picked request or of all requests
};

type Loaded = { usage: Usage; requestId: number | null };

function usedBySegment(segments: { segment_id: number; used_cores: number }[]): Map<number, number> {
  return new Map(segments.map((segment) => [segment.segment_id, segment.used_cores]));
}

// "12 Mar" for a calendar date, in the app's display time zone.
function shortDate(isoDate: string): string {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short" });
  return format.format(new Date(`${isoDate}T12:00:00+08:00`));
}

export function requestName(request: CustomerRequest): string {
  return request.srf_id ?? `Request #${request.reservation_id}`;
}

// Picker option text, e.g. "SRF-0042 · 3 cores · 12 Mar".
export function requestOptionText(request: CustomerRequest): string {
  const parts = [requestName(request), plural(request.used_cores, "core")];
  if (request.planned_date) {
    parts.push(shortDate(request.planned_date));
  }
  return parts.join(" · ");
}

// The picker lists only requests that use cores; a Requested-only request (0 used) has nothing to show.
// "All requests" still sums the whole usage response.
function highlightOf(loaded: Loaded): CustomerHighlight {
  const { usage, requestId } = loaded;
  const requests = usage.reservations.filter((item) => item.used_cores > 0);
  const request = requests.find((item) => item.reservation_id === requestId) ?? null;
  const segments = request ? request.segments : usage.segments;
  return { id: usage.customer_id, name: usage.name, requests, request, used: usedBySegment(segments) };
}

export function useCustomerHighlight(routeFound: boolean, onError: (message: string) => void) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // A route found in Site A to B takes over the map, so customer mode ends.
  if (routeFound && loaded) {
    setLoaded(null);
  }

  // A new customer always starts on all requests, so a request picked before never carries over.
  const show = async (customerId: number) => {
    try {
      const usage = await api.get("/api/customers/{customer_id}/usage", { path: { customer_id: customerId } });
      setLoaded({ usage, requestId: null });
    } catch {
      onError("Could not load the customer's segments.");
    }
  };

  const pickRequest = (requestId: number | null) => {
    setLoaded((current) => {
      if (!current) {
        return current;
      }
      return { ...current, requestId };
    });
  };

  const clear = () => setLoaded(null);

  const customer = useMemo(() => {
    if (!loaded) {
      return null;
    }
    return highlightOf(loaded);
  }, [loaded]);
  return { customer, show, pickRequest, clear };
}
