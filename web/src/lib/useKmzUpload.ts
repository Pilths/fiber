import { useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { uploadError } from "@/lib/utils";

export type FolderNode = components["schemas"]["KmzFolder"];

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
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Applied | null>(null);
  const applying = useRef(false);

  const upload = async (chosen: File, folderIds: string[]) => {
    setStaged(await api.postFile("/api/admin/kmz/uploads", chosen, folderFields(folderIds)));
  };

  const pick = async (chosen: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    setStaged(null);
    setConfirming(false);
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

  // A double click on Apply sends one request.
  const apply = async () => {
    if (!staged || applying.current) {
      return;
    }
    applying.current = true;
    setError(null);
    try {
      const path = { upload_id: staged.upload_id };
      setResult(await api.post("/api/admin/kmz/uploads/{upload_id}/apply", { path }));
      setStaged(null);
    } catch (caught) {
      setError(errorText(caught, "Apply failed. Nothing was changed. Try again."));
    } finally {
      applying.current = false;
      setConfirming(false);
    }
  };

  const discard = () => {
    setStaged(null);
  };

  const canPreview = !busy && selected.size > 0;

  return {
    folders, selected, toggle, canPreview, preview,
    staged, busy, error, confirming, setConfirming, result, pick, apply, discard,
  };
}
