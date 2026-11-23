import { useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";

export type MapGroup = components["schemas"]["KmzGroupListed"];
export type GroupPatch = Omit<components["schemas"]["KmzGroupPatch"], "remarks">;
export type GroupOwner = { kind: "segment" | "site" | "cluster"; id: number };
export type Cluster = components["schemas"]["KmzCluster"];

function ownerQuery(owner: GroupOwner) {
  if (owner.kind === "segment") {
    return { segment_id: owner.id };
  }
  if (owner.kind === "site") {
    return { site_id: owner.id };
  }
  return { cluster_id: owner.id };
}

// The KMZ groups attached to one segment, site or cluster (hidden ones included). Each change is saved at once
// and the list loads again; a failure goes to onError.
export function useMapGroups(owner: GroupOwner, onError: (message: string | null) => void) {
  const [groups, setGroups] = useState<MapGroup[] | null>(null);
  const [version, setVersion] = useState(0);
  const { kind, id } = owner;

  useEffect(() => {
    let stale = false;
    api.get("/api/admin/kmz/groups", { query: ownerQuery({ kind, id }) })
      .then((loaded) => {
        if (!stale) {
          setGroups(loaded);
        }
      })
      .catch((caught) => onError(errorText(caught, "Could not load the map elements.")));
    return () => {
      stale = true;
    };
  }, [kind, id, version, onError]);

  const reload = () => setVersion((old) => old + 1);

  const change = async (groupId: number, body: GroupPatch) => {
    onError(null);
    try {
      const path = { group_id: groupId };
      await api.patch("/api/admin/kmz/groups/{group_id}", { path, body: { ...body, remarks: "" } });
    } catch (caught) {
      onError(errorText(caught, "Could not save. Try again."));
    }
    reload();
  };

  return { groups, change, reload };
}

// Clusters with their sites: rename, add a site, remove a site. Every change reloads the list.
export function useClusters() {
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let stale = false;
    api.get("/api/admin/kmz/clusters")
      .then((loaded) => {
        if (!stale) {
          setClusters(loaded);
        }
      })
      .catch((caught) => setError(errorText(caught, "Could not load the clusters.")));
    return () => {
      stale = true;
    };
  }, [version]);

  const run = async (call: () => Promise<unknown>) => {
    setError(null);
    try {
      await call();
    } catch (caught) {
      setError(errorText(caught, "Could not save. Try again."));
    }
    setVersion((old) => old + 1);
  };

  const rename = (clusterId: number, name: string) => run(() => api.patch(
    "/api/admin/kmz/clusters/{cluster_id}", { path: { cluster_id: clusterId }, body: { name, remarks: "" } },
  ));
  const addSite = (clusterId: number, siteId: number) => run(() => api.post(
    "/api/admin/kmz/clusters/{cluster_id}/sites",
    { path: { cluster_id: clusterId }, body: { site_id: siteId, remarks: "" } },
  ));
  const removeSite = (clusterId: number, siteId: number) => run(() => api.delete(
    "/api/admin/kmz/clusters/{cluster_id}/sites/{site_id}", { path: { cluster_id: clusterId, site_id: siteId } },
  ));

  return { clusters, error, setError, rename, addSite, removeSite };
}
