import { useEffect, useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import type { MapData, SegmentFeature, SiteFeature } from "@/lib/mapLayers";
import { segmentName } from "@/lib/status";

export type RouteLine = components["schemas"]["KmzRouteLineOut"];
export type Group = "ready" | "check" | "skipped";
export type SegmentInfo = { id: number; name: string; siteIds: [number, number] | null; shaped: boolean };
export type SitePoint = { name: string; lonLat: [number, number] };
type Applied = components["schemas"]["KmzApplyOut"];

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

// A line equal to a stored route, or drawn twice in the file, starts in Skipped.
export function startsTicked(line: RouteLine): boolean {
  return !line.same && !line.duplicate;
}

function titleAssignments(lines: RouteLine[]): Record<string, number> {
  const assigned: Record<string, number> = {};
  for (const line of lines) {
    if (line.suggested_segment_id != null) {
      assigned[line.key] = line.suggested_segment_id;
    }
  }
  return assigned;
}

function titledTicked(lines: RouteLine[]): string[] {
  return lines.filter((line) => line.suggested_segment_id != null && startsTicked(line)).map((line) => line.key);
}

// Select step state: which segment each line goes to, and which lines are ticked. Lines with a segment from their
// title start ticked (unless same or duplicate); nothing is saved until apply.
export function useKmzImport(uploadId: number, lines: RouteLine[]) {
  const [assigned, setAssigned] = useState<Record<string, number>>(() => titleAssignments(lines));
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(titledTicked(lines)));
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

  // A same or duplicate line stays in Skipped until the admin ticks it.
  const groupOf = (line: RouteLine): Group => {
    if ((line.same || line.duplicate) && !ticked.has(line.key)) {
      return "skipped";
    }
    if (assigned[line.key] == null) {
      return "check";
    }
    return "ready";
  };
  const inGroup = (group: Group) => lines.filter((line) => groupOf(line) === group);
  const segmentOf = (line: RouteLine): number | null => assigned[line.key] ?? line.closest_segment_id ?? null;

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

  // Ticking a line with no segment yet (a skipped one) takes its closest suggestion; with none it cannot be ticked.
  const tick = (line: RouteLine, checked: boolean) => {
    if (checked && assigned[line.key] == null) {
      if (line.closest_segment_id == null) {
        return;
      }
      setAssigned({ ...assigned, [line.key]: line.closest_segment_id });
    }
    setTick([line.key], checked);
  };

  // Accept on a suggestion, or a segment chosen from the list: the line goes to Ready, ticked.
  const assign = (line: RouteLine, segmentId: number) => {
    setAssigned({ ...assigned, [line.key]: segmentId });
    setTick([line.key], true);
  };

  const tickedLines = lines.filter((line) => ticked.has(line.key) && assigned[line.key] != null);

  // Status word of a Ready row: a segment that already has a drawn route is replaced.
  const statusOf = (line: RouteLine): "new" | "Route Replaced" => {
    if (segments.get(assigned[line.key])?.shaped) {
      return "Route Replaced";
    }
    return "new";
  };

  // A double click on Add sends one request.
  const apply = async (): Promise<Applied | null> => {
    if (applying.current) {
      return null;
    }
    applying.current = true;
    setBusy(true);
    setError(null);
    try {
      const routeLines = tickedLines.map((line) => ({ key: line.key, segment_id: assigned[line.key] }));
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
    lines, assigned, ticked, segments, sites, groupOf, inGroup, segmentOf, tick, assign, statusOf,
    tickedLines, apply, busy, error,
  };
}

export type KmzImport = ReturnType<typeof useKmzImport>;
