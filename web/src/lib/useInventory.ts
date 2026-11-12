import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import type { View } from "@/components/Header";
import type { Found } from "@/components/NetworkDetail";
import { inFilter, NO_FILTER, segmentName, type LossDetail, type SegmentFilter } from "@/lib/status";
import { useRoutePlanner, type RouteOption } from "@/lib/useRoutePlanner";

export type Segment = components["schemas"]["SegmentSummary"];
export type Detail = components["schemas"]["SegmentDetail"];

// Selection lives in the URL hash so links can be shared: #segment=<site A> - <site B>.
// The API has no LRD codes on segments yet, so the hash uses the segment name,
// not the AABB-BBCC form of the PRD.
// A found route uses #route=... (see lib/useRoutePlanner.ts).
function readSegmentHash(): string | null {
  // Old links used #span=: rewrite them to #segment= in place.
  if (location.hash.startsWith("#span=")) {
    history.replaceState(null, "", "#segment=" + location.hash.slice(6));
  }
  const match = /^#segment=(.+)$/.exec(location.hash);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function foundRoute(option: RouteOption | null): Found | null {
  if (!option) {
    return null;
  }
  const segments = option.segments;
  return {
    ids: segments.map((segment) => segment.segment_id),
    km: option.total_km,
    sites: [segments[0].site_a, ...segments.map((segment) => segment.site_b)],
  };
}

// Segment list, the selected segment with its detail and loss, the Region filter, and the found route.
export function useInventory(view: View, version: number) {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [segmentId, setSegmentId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loss, setLoss] = useState<LossDetail | null>(null);
  const [focusCoreId, setFocusCoreId] = useState<number | null>(null);
  const [reserving, setReserving] = useState(false);
  // reservation id of the last request: success box and highlighted row
  const [sent, setSent] = useState<number | null>(null);
  const [drawerCore, setDrawerCore] = useState<number | null>(null);
  const [filter, setFilter] = useState<SegmentFilter>(NO_FILTER);
  // Site A to B beside the map; the chosen option is the found route,
  // drawn on the map and the segment diagram.
  const routePlanner = useRoutePlanner(view === "map", version);
  const option = routePlanner.option;
  const found = foundRoute(option);
  const foundKey = found?.ids.join(",");

  useEffect(() => {
    api.get("/api/segments").then(setSegments).catch(() => setError("Could not load segments."));
  }, [version, view]);

  useEffect(() => {
    if (segmentId == null) {
      return;
    }
    let stale = false;
    const path = { path: { segment_id: segmentId } };
    api.get("/api/segments/{segment_id}", path)
      .then((loaded) => {
        if (!stale) {
          setDetail(loaded);
        }
      })
      .catch(() => {
        if (!stale) {
          setError("Could not load the segment.");
        }
      });
    api.get("/api/loss/segments/{segment_id}", path)
      .then((loaded) => {
        if (!stale) {
          setLoss(loaded);
        }
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [segmentId, version]);

  const segmentRef = useRef(segmentId);
  useEffect(() => {
    segmentRef.current = segmentId;
  }, [segmentId]);

  // Selects a segment on Inventory.
  // The old detail stays on screen (faded) until the new one loads, so the page keeps its height and scroll.
  const open = useCallback((id: number, coreId: number | null = null) => {
    setSegmentId(id);
    setFocusCoreId(coreId);
    setReserving(false);
    setSent(null);
    setDrawerCore(null);
  }, []);

  // Hash -> selection, on load and when the hash changes (back button, pasted link).
  useEffect(() => {
    if (!segments) {
      return;
    }
    const sync = () => {
      const name = readSegmentHash();
      const segment = name ? segments.find((candidate) => segmentName(candidate) === name) : undefined;
      if (segment && segmentRef.current !== segment.id) {
        open(segment.id);
      }
    };
    sync();
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, [segments, open]);

  // A newly found route (or another option) selects its first segment.
  // A segment of another option clicked on the map switches to that option and selects that segment.
  const [seenRoute, setSeenRoute] = useState(foundKey);
  const [pickAfter, setPickAfter] = useState<number | null>(null);
  if (seenRoute !== foundKey) {
    setSeenRoute(foundKey);
    setPickAfter(null);
    if (found) {
      const keepPicked = pickAfter != null && found.ids.includes(pickAfter);
      open(keepPicked ? pickAfter : found.ids[0]);
    }
  }

  // Selection -> hash; a found route keeps its #route= hash.
  useEffect(() => {
    const segment = segments?.find((candidate) => candidate.id === segmentId);
    if (!segment || foundKey) {
      return;
    }
    const name = segmentName(segment);
    if (readSegmentHash() !== name) {
      history.replaceState(null, "", `#segment=${encodeURIComponent(name)}`);
    }
  }, [segmentId, segments, foundKey]);

  // Route mode: only the options' segments can be clicked on the map; the rest stay faint.
  const options = routePlanner.result?.options;
  let optionIds: Set<number> | null = null;
  if (found) {
    const allOptionIds = options?.flatMap((each) => each.segments.map((segment) => segment.segment_id));
    optionIds = new Set(allOptionIds ?? found.ids);
  }

  const pickOnMap = (id: number) => {
    if (!found || found.ids.includes(id)) {
      open(id);
      return;
    }
    const hasSegment = (each: RouteOption) => each.segments.some((segment) => segment.segment_id === id);
    const index = options?.findIndex(hasSegment) ?? -1;
    if (index >= 0) {
      setPickAfter(id);
      routePlanner.select(index);
    }
  };

  // Map: Esc clears the selection and the searched route.
  const clearSelection = () => {
    setSegmentId(null);
    setDetail(null);
    setDrawerCore(null);
    routePlanner.clear();
    if (location.hash.startsWith("#segment=")) {
      history.replaceState(null, "", location.pathname);
    }
  };

  // "Clear route" also unselects the segment the route had selected.
  const planner = {
    ...routePlanner,
    reset: () => {
      routePlanner.reset();
      clearSelection();
    },
  };

  // A Region filter that hides the selected segment unselects it; a found route ignores the filter.
  const changeFilter = (next: SegmentFilter) => {
    setFilter(next);
    const selected = segments?.find((segment) => segment.id === segmentId);
    if (!found && selected && !inFilter(selected, next)) {
      clearSelection();
    }
  };

  // Header search: go to the map, leave route mode, select the segment (and the core).
  const openFromSearch = (id: number, coreId: number | null) => {
    routePlanner.clear();
    open(id, coreId);
  };

  const mapIds: number[] = [];
  if (found) {
    mapIds.push(...found.ids);
  }
  if (segmentId != null && !mapIds.includes(segmentId)) {
    mapIds.push(segmentId);
  }
  const segmentLoss = loss?.segment_id === segmentId ? loss : null;
  const onRoute = option && detail && found?.ids.includes(detail.id) ? option : null;

  return {
    segments,
    error,
    setError,
    segmentId,
    detail,
    segmentLoss,
    focusCoreId,
    reserving,
    setReserving,
    sent,
    setSent,
    drawerCore,
    setDrawerCore,
    filter,
    changeFilter,
    planner,
    option,
    found,
    onRoute,
    optionIds,
    mapIds,
    open,
    openFromSearch,
    pickOnMap,
    clearSelection,
  };
}

export type Inventory = ReturnType<typeof useInventory>;
