import { useEffect, useLayoutEffect, useState } from "react";
import { api } from "@/api/client";
import { nextZoomedIn, type SectorData } from "@/lib/mapClusters";
import { fitView, MALAYSIA, type Camera, type Size } from "@/lib/mapGeometry";
import type { MapData, SegmentFeature, SiteFeature } from "@/lib/mapLayers";

export function useFullscreen(box: React.RefObject<HTMLDivElement | null>) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [box]);
  const toggleFull = () => {
    const request = full ? document.exitFullscreen() : box.current!.requestFullscreen();
    request.catch(() => {});
  };
  return { full, toggleFull };
}

// Sectors are extra: if they fail to load the map still draws, with every site shown as a plain marker.
function loadSectors(): Promise<SectorData> {
  const empty: SectorData = { features: [] };
  return api.get("/api/map/sectors")
    .then((loaded) => loaded as unknown as SectorData)
    .catch(() => empty);
}

export function useMapData(version: number) {
  const [segments, setSegments] = useState<MapData<SegmentFeature> | null>(null);
  const [sites, setSites] = useState<MapData<SiteFeature> | null>(null);
  const [sectors, setSectors] = useState<SectorData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([api.get("/api/map/segments"), api.get("/api/map/sites"), loadSectors()])
      .then(([loadedSegments, loadedSites, loadedSectors]) => {
        if (live) {
          setSegments(loadedSegments as unknown as MapData<SegmentFeature>);
          setSites(loadedSites as unknown as MapData<SiteFeature>);
          setSectors(loadedSectors);
        }
      })
      .catch(() => {
        if (live) {
          setFailed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [version]);
  return { segments, sites, sectors, failed };
}

// Clusters layer: whether the map is zoomed in past the sectors (with a dead band, see nextZoomedIn).
export function useClusterLayer(camera: Camera | null) {
  const [zoomedIn, setZoomedIn] = useState(false);
  if (camera) {
    const next = nextZoomedIn(zoomedIn, camera.zoom);
    if (next !== zoomedIn) {
      setZoomedIn(next);
    }
  }
  return { zoomedIn };
}

// Map size from the card; the camera starts on Malaysia (the data fit follows once segments arrive).
export type CameraUpdate = (current: Camera | null) => Camera | null;

export function useMapSize(box: React.RefObject<HTMLDivElement | null>, setCamera: (update: CameraUpdate) => void) {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const element = box.current!;
    const observer = new ResizeObserver(() => {
      setSize({ w: element.clientWidth, h: element.clientHeight });
      setCamera((current) => {
        if (current || !element.clientWidth) {
          return current;
        }
        return fitView(MALAYSIA, element.clientWidth, element.clientHeight, 8);
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [box, setCamera]);
  return size;
}
