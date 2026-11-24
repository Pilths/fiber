import { useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";

export type MapGroup = components["schemas"]["KmzGroupListed"];
export type GroupPatch = Omit<components["schemas"]["KmzGroupPatch"], "remarks">;
export type GroupOwner = { kind: "segment" | "site" | "cluster"; id: number };

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
