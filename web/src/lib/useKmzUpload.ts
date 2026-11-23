import { useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { segmentName } from "@/lib/status";
import { uploadError } from "@/lib/utils";

export type FolderNode = components["schemas"]["KmzFolder"];
export type KmzGroup = components["schemas"]["KmzGroupOut"];
export type Target = KmzGroup["default_target"];
export type ColourMode = "theme" | "kmz";
export type Named = { id: number; name: string };
export type TargetLists = { segment: Named[]; site: Named[]; cluster: Named[] };

// What the admin chose for one folder. `pick` is the typed segment, site or cluster name; a cluster name that is
// not in the list is a new cluster.
export type GroupChoice = {
  included: boolean;
  target: Target;
  pick: string;
  colourMode: ColourMode;
  members: number[];
};

type MapSites = { features: { properties: { site_id: number; name: string } }[] };

function sameName(first: string, second: string): boolean {
  return first.trim().toLowerCase() === second.trim().toLowerCase();
}

// The id the picked name stands for, or null when no item in the list has that name.
export function pickedId(choice: GroupChoice, lists: TargetLists | null): number | null {
  if (choice.target === "skip" || lists == null) {
    return null;
  }
  const found = lists[choice.target].find((item) => sameName(item.name, choice.pick));
  return found?.id ?? null;
}

export function isNewCluster(choice: GroupChoice, lists: TargetLists | null): boolean {
  return choice.target === "cluster" && choice.pick.trim() !== "" && pickedId(choice, lists) == null;
}

// A ticked row needs a target: a segment or site from the list, or any cluster name.
export function needsTarget(choice: GroupChoice, lists: TargetLists | null): boolean {
  if (!choice.included) {
    return false;
  }
  if (choice.target === "skip") {
    return true;
  }
  if (choice.target === "cluster") {
    return choice.pick.trim() === "";
  }
  return pickedId(choice, lists) == null;
}

// The default: the backend's target (a site or cluster with the folder's name), ticked unless it is Skip.
function defaultChoice(group: KmzGroup): GroupChoice {
  let pick = "";
  if (group.default_target !== "skip") {
    pick = group.name;
  }
  return {
    included: group.default_target !== "skip",
    target: group.default_target,
    pick,
    colourMode: "theme",
    members: group.member_site_ids,
  };
}

// Text in the picker after switching target: a new cluster starts with the folder name.
export function pickFor(target: Target, group: KmzGroup): string {
  if (target === "cluster") {
    return group.name;
  }
  return "";
}

async function loadTargetLists(): Promise<TargetLists> {
  const [segments, sites, clusters] = await Promise.all([
    api.get("/api/segments"),
    api.get("/api/map/sites"),
    api.get("/api/admin/kmz/clusters"),
  ]);
  // ponytail: /api/map/sites leaves out sites with no point; a site picker over every site needs its own list.
  const siteFeatures = (sites as unknown as MapSites).features;
  return {
    segment: segments.map((segment) => ({ id: segment.id, name: segmentName(segment) })),
    site: siteFeatures.map((feature) => ({ id: feature.properties.site_id, name: feature.properties.name })),
    cluster: clusters,
  };
}

const DEFAULT_FOLDER = "propose route";

function subtreeIds(node: FolderNode): string[] {
  return [node.id, ...node.children.flatMap(subtreeIds)];
}

function findByName(nodes: FolderNode[], name: string): FolderNode | null {
  for (const node of nodes) {
    if (node.name.trim().toLowerCase() === name) {
      return node;
    }
    const found = findByName(node.children, name);
    if (found) {
      return found;
    }
  }
  return null;
}

// "propose route" and everything under it, when the file has that folder.
function defaultSelection(nodes: FolderNode[]): Set<string> {
  const node = findByName(nodes, DEFAULT_FOLDER);
  if (node == null) {
    return new Set();
  }
  return new Set(subtreeIds(node));
}

// A ticked folder already reads its subfolders, so only the top-most ticked folders are sent.
function topSelected(nodes: FolderNode[], selected: Set<string>): string[] {
  return nodes.flatMap((node) => {
    if (selected.has(node.id)) {
      return [node.id];
    }
    return topSelected(node.children, selected);
  });
}

// Ticking a folder ticks its subfolders. Unticking one also unticks its parents, so a ticked parent
// always means the whole folder is read.
function toggleFolder(
  selected: Set<string>, node: FolderNode, ancestorIds: string[], checked: boolean,
): Set<string> {
  const next = new Set(selected);
  if (checked) {
    for (const id of subtreeIds(node)) {
      next.add(id);
    }
    return next;
  }
  for (const id of [...subtreeIds(node), ...ancestorIds]) {
    next.delete(id);
  }
  return next;
}

export type KmzStaged = components["schemas"]["KmzUploadOut"];
type Applied = components["schemas"]["KmzApplyOut"];

// A file with no folders sends a blank folder, so the API reads every line in it.
function folderFields(folderIds: string[]): Record<string, string | string[]> {
  if (folderIds.length === 0) {
    return { folder: "" };
  }
  return { folder_ids: folderIds };
}

// Pick file -> folder tree -> preview -> apply. State and actions live here so the screen parts stay plain.
export function useKmzUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [staged, setStaged] = useState<KmzStaged | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Applied | null>(null);
  const [routeIds, setRouteIds] = useState<Set<number>>(new Set());
  const [choices, setChoices] = useState<Record<string, GroupChoice>>({});
  const [lists, setLists] = useState<TargetLists | null>(null);
  const applying = useRef(false);

  const upload = async (chosen: File, folderIds: string[]) => {
    const loaded: KmzStaged = await api.postFile("/api/admin/kmz/uploads", chosen, folderFields(folderIds));
    if (loaded.groups.length > 0) {
      setLists(await loadTargetLists());
    }
    setRouteIds(new Set(loaded.shaped.map((row) => row.segment_id)));
    const initial: Record<string, GroupChoice> = {};
    for (const group of loaded.groups) {
      initial[group.key] = defaultChoice(group);
    }
    setChoices(initial);
    setStaged(loaded);
  };

  const pick = async (chosen: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    setStaged(null);
    setFile(chosen);
    setFolders([]);
    try {
      const found = await api.postFile("/api/admin/kmz/folders", chosen);
      if (found.folders.length === 0) {
        await upload(chosen, []);
        return;
      }
      setFolders(found.folders);
      setSelected(defaultSelection(found.folders));
    } catch (caught) {
      setError(uploadError(caught));
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    if (!file) {
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setStaged(null);
    try {
      await upload(file, topSelected(folders, selected));
    } catch (caught) {
      setError(uploadError(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (node: FolderNode, ancestorIds: string[], checked: boolean) => {
    setSelected(toggleFolder(selected, node, ancestorIds, checked));
  };

  const selectAll = () => {
    setSelected(new Set(folders.flatMap(subtreeIds)));
  };

  const selectNone = () => {
    setSelected(new Set());
  };

  const toggleRoute = (segmentId: number, checked: boolean) => {
    const next = new Set(routeIds);
    if (checked) {
      next.add(segmentId);
    } else {
      next.delete(segmentId);
    }
    setRouteIds(next);
  };

  const changeChoice = (key: string, change: Partial<GroupChoice>) => {
    setChoices((current) => ({ ...current, [key]: { ...current[key], ...change } }));
  };

  const chosenGroups = Object.entries(choices).filter(([, choice]) => choice.included);
  const missingTarget = chosenGroups.some(([, choice]) => needsTarget(choice, lists));
  const routeCount = staged ? staged.shaped.filter((row) => routeIds.has(row.segment_id)).length : 0;
  const canApply = !missingTarget && routeCount + chosenGroups.length > 0;

  const applyBody = () => ({
    route_segment_ids: [...routeIds],
    groups: chosenGroups.map(([key, choice]) => {
      const targetId = pickedId(choice, lists);
      const newCluster = isNewCluster(choice, lists);
      let members: number[] = [];
      if (newCluster) {
        members = choice.members;
      }
      let newClusterName = null;
      if (newCluster) {
        newClusterName = choice.pick.trim();
      }
      return {
        key,
        target: choice.target,
        target_id: targetId,
        new_cluster_name: newClusterName,
        colour_mode: choice.colourMode,
        member_site_ids: members,
      };
    }),
  });

  // A double click on Apply sends one request.
  const apply = async () => {
    if (!staged || applying.current) {
      return;
    }
    applying.current = true;
    setError(null);
    try {
      const path = { upload_id: staged.upload_id };
      setResult(await api.post("/api/admin/kmz/uploads/{upload_id}/apply", { path, body: applyBody() }));
      setStaged(null);
      setFolders([]);
    } catch (caught) {
      setError(errorText(caught, "Apply failed. Nothing was changed. Try again."));
    } finally {
      applying.current = false;
    }
  };

  const discard = () => {
    setStaged(null);
  };

  const reset = () => {
    setFile(null);
    setFolders([]);
    setSelected(new Set());
    setStaged(null);
    setResult(null);
    setError(null);
  };

  const canPreview = !busy && selected.size > 0;

  return {
    folders, selected, toggle, selectAll, selectNone, canPreview, preview,
    staged, busy, error, result, pick, apply, discard, reset,
    routeIds, toggleRoute, choices, changeChoice, lists, routeCount, groupCount: chosenGroups.length, canApply,
  };
}
