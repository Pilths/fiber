import { useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import type { SitePoint } from "@/lib/useKmzImport";
import type { KmzStaged } from "@/lib/useKmzUpload";
import { uploadError } from "@/lib/utils";

export type LineStatus = components["schemas"]["StagedLineStatus"];
type Found = components["schemas"]["SegmentLineStatusOut"];
type MapSites = { features: { properties: { site_id: number; name: string }; geometry: { coordinates: [number, number] } }[] };

async function stage(file: File): Promise<KmzStaged> {
  const found = await api.postFile("/api/admin/kmz/folders", file);
  if (found.folders.length === 0) {
    return api.postFile("/api/admin/kmz/uploads", file, { folder: "" });
  }
  return api.postFile("/api/admin/kmz/uploads", file, { folder_ids: found.folders.map((folder) => folder.id) });
}

async function loadSites(siteIds: number[]): Promise<SitePoint[]> {
  const sites = (await api.get("/api/map/sites")) as unknown as MapSites;
  return sites.features
    .filter((feature) => siteIds.includes(feature.properties.site_id))
    .map((feature) => ({ name: feature.properties.name, lonLat: feature.geometry.coordinates }));
}

// "Upload KMZ route" for one segment: pick the file, see each line against the stored routes, tick, add.
// "same" lines start unticked; everything else starts ticked.
export function useUploadRoute(segmentId: number, siteIds: number[]) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [staged, setStaged] = useState<KmzStaged | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [sites, setSites] = useState<SitePoint[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adding = useRef(false);

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    setFileName(file.name);
    try {
      const loaded = await stage(file);
      const path = { upload_id: loaded.upload_id, segment_id: segmentId };
      const statuses = await api.get("/api/admin/kmz/uploads/{upload_id}/segments/{segment_id}/lines", { path });
      setSites(await loadSites(siteIds));
      setStaged(loaded);
      setFound(statuses);
      setTicked(new Set(statuses.lines.filter((line) => line.status !== "same").map((line) => line.key)));
    } catch (caught) {
      setStaged(null);
      setError(uploadError(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string, checked: boolean) => {
    const next = new Set(ticked);
    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
    setTicked(next);
  };

  // A double click on Add sends one request.
  const add = async (): Promise<boolean> => {
    if (!staged || adding.current) {
      return false;
    }
    adding.current = true;
    setBusy(true);
    setError(null);
    try {
      const routeLines = [...ticked].map((key) => ({ key, segment_id: segmentId }));
      const path = { upload_id: staged.upload_id };
      await api.post("/api/admin/kmz/uploads/{upload_id}/apply", {
        path, body: { route_lines: routeLines, groups: [], per_segment: true },
      });
      return true;
    } catch (caught) {
      setError(errorText(caught, "Could not add the routes. Nothing was changed. Try again."));
      return false;
    } finally {
      adding.current = false;
      setBusy(false);
    }
  };

  return { fileName, staged, found, sites, ticked, toggle, pick, add, busy, error };
}
