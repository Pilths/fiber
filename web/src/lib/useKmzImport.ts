import { useEffect, useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import type { MapData, SegmentFeature, SiteFeature } from "@/lib/mapLayers";
import { segmentName } from "@/lib/status";

export type RouteLine = components["schemas"]["KmzRouteLineOut"];
export type Source = "title" | "suggested" | "added";
export type Assignment = { segmentId: number; source: Source };
export type SegmentInfo = { id: number; name: string; siteIds: [number, number] | null; shaped: boolean };
export type SitePoint = { name: string; lonLat: [number, number] };
type Applied = components["schemas"]["KmzApplyOut"];

// "A-B" with one dash and a name on each side: a title the backend reads as a site pair.
const PAIR_TITLE = /^[^-]+-[^-]+$/;

export function unmatchedReason(line: RouteLine): string {
  if (PAIR_TITLE.test(line.name.trim())) {
    return "no segment";
  }
  return "no title";
}

// Segments (all, for the dropdowns), which ones already have a line on the map, and the site points.
async function loadNetwork(): Promise<{ segments: Map<number, SegmentInfo>; sites: Map<number, SitePoint> }> {
  const [listed, mapSegments, mapSites] = await Promise.all([
    api.get("/api/segments"),
    api.get("/api/map/segments"),
    api.get("/api/map/sites"),
  ]);
  const features = (mapSegments as unknown as MapData<SegmentFeature>).features;
  const segments = new Map<number, SegmentInfo>();
  for (const segment of listed) {
    segments.set(segment.id, { id: segment.id, name: segmentName(segment), siteIds: null, shaped: false });
  }
  for (const feature of features) {
    const known = segments.get(feature.properties.segment_id);
    if (known && !feature.properties.extra_line) {
      known.siteIds = [feature.properties.site_a_id, feature.properties.site_b_id];
      known.shaped = feature.properties.shaped === true;
    }
  }
  const sites = new Map<number, SitePoint>();
  for (const feature of (mapSites as unknown as MapData<SiteFeature>).features) {
    sites.set(feature.properties.site_id, { name: feature.properties.name, lonLat: feature.geometry.coordinates });
  }
  return { segments, sites };
}

function titleAssignments(lines: RouteLine[]): Record<string, Assignment> {
  const assigned: Record<string, Assignment> = {};
  for (const line of lines) {
    if (line.suggested_segment_id != null) {
      assigned[line.key] = { segmentId: line.suggested_segment_id, source: "title" };
    }
  }
  return assigned;
}

// Select step state: which segment each line goes to, and which lines are ticked. Lines with a segment from their
// title start ticked; nothing is saved until apply.
export function useKmzImport(uploadId: number, lines: RouteLine[]) {
  const [assigned, setAssigned] = useState<Record<string, Assignment>>(() => titleAssignments(lines));
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(Object.keys(titleAssignments(lines))));
  const [segments, setSegments] = useState<Map<number, SegmentInfo>>(new Map());
  const [sites, setSites] = useState<Map<number, SitePoint>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applying = useRef(false);

  useEffect(() => {
    loadNetwork()
      .then((network) => {
        setSegments(network.segments);
        setSites(network.sites);
      })
      .catch((caught) => setError(errorText(caught, "Could not load the segments. Close the box and try again.")));
  }, []);

  // Segment ids in the order their first line appears in the file.
  const segmentOrder: number[] = [];
  for (const line of lines) {
    const assignment = assigned[line.key];
    if (assignment && !segmentOrder.includes(assignment.segmentId)) {
      segmentOrder.push(assignment.segmentId);
    }
  }
  const linesOf = (segmentId: number) => lines.filter((line) => assigned[line.key]?.segmentId === segmentId);
  const unmatched = lines.filter((line) => assigned[line.key] == null);

  const setTick = (keys: string[], checked: boolean) => {
    const next = new Set(ticked);
    for (const key of keys) {
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
    }
    setTicked(next);
  };

  // Lines picked by hand go under the segment as "added" and are ticked.
  const assign = (keys: string[], segmentId: number) => {
    const next = { ...assigned };
    for (const key of keys) {
      next[key] = { segmentId, source: "added" };
    }
    setAssigned(next);
    setTick(keys, true);
  };

  // Fills only lines still without a segment; never overwrites a title or a pick.
  const suggestByLocation = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = { upload_id: uploadId };
      const found = await api.post("/api/admin/kmz/uploads/{upload_id}/suggest-by-location", { path });
      const next = { ...assigned };
      const newKeys: string[] = [];
      for (const suggestion of found) {
        if (next[suggestion.key] == null) {
          next[suggestion.key] = { segmentId: suggestion.segment_id, source: "suggested" };
          newKeys.push(suggestion.key);
        }
      }
      setAssigned(next);
      setTick(newKeys, true);
      return newKeys.length;
    } catch (caught) {
      setError(errorText(caught, "Suggest by location failed. Try again."));
      return 0;
    } finally {
      setBusy(false);
    }
  };

  const tickedLines = lines.filter((line) => ticked.has(line.key) && assigned[line.key] != null);
  const suggestedCount = tickedLines.filter((line) => assigned[line.key].source === "suggested").length;
  const tickedSegments = new Set(tickedLines.map((line) => assigned[line.key].segmentId));

  // A double click on Apply sends one request.
  const apply = async (): Promise<Applied | null> => {
    if (applying.current) {
      return null;
    }
    applying.current = true;
    setBusy(true);
    setError(null);
    try {
      const routeLines = tickedLines.map((line) => ({ key: line.key, segment_id: assigned[line.key].segmentId }));
      const path = { upload_id: uploadId };
      return await api.post("/api/admin/kmz/uploads/{upload_id}/apply", {
        path, body: { route_lines: routeLines, groups: [] },
      });
    } catch (caught) {
      setError(errorText(caught, "Apply failed. Nothing was changed. Try again."));
      return null;
    } finally {
      applying.current = false;
      setBusy(false);
    }
  };

  return {
    lines, assigned, ticked, segments, sites, segmentOrder, linesOf, unmatched, setTick, assign,
    suggestByLocation, tickedLines, suggestedCount, tickedSegments, apply, busy, error,
  };
}

export type KmzImport = ReturnType<typeof useKmzImport>;
