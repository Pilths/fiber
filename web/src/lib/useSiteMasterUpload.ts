import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { PAGE_SIZE } from "@/components/upload-parts";
import { uploadError } from "@/lib/utils";

export type Staged = components["schemas"]["app__ingest__site_master_router__UploadOut"];
export type Sheet = components["schemas"]["SheetOut"];
export type Applied = components["schemas"]["app__ingest__site_master_router__ApplyOut"];
export type Group = "added" | "changed" | "missing" | "problem" | "unchanged";
export type Row = {
  id: number;
  row_number: number | null;
  key: string;
  status: string | null;
  reason: string | null;
  changes: { field: string; old: unknown; new: unknown; protected?: boolean; note?: string }[];
  in_use: boolean | null;
  raw: Record<string, unknown> | null;
  parsed: {
    lat?: number | null;
    lon?: number | null;
  } | null;
};
export type FileInfo = {
  upload_id: number;
  filename: string;
  status: string;
  uploaded_at: string;
  applied_at: string | null;
  uploaded_by: string;
  // an upload from before 16 Nov 2026 may also list a "dcs" sheet, which is not shown
  sheets: { sites?: { sheet_name: string | null; found: boolean; rows: number } };
};
export type Uploads = { current: FileInfo | null; previous: FileInfo[] };
type RowPage = { total: number; items: Row[] };

function willApply(sheet: Sheet, override: boolean): boolean {
  return sheet.found && (!sheet.blocked || (sheet.needs_override && override));
}

// One page of a sheet's preview rows, filtered by result group.
export function useSheetRows(uploadId: number, sheet: Sheet, firstGroup: Group) {
  const [group, setGroup] = useState<Group>(firstGroup);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RowPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sheet.found) {
      return;
    }
    let stale = false;
    const path = { upload_id: uploadId };
    const query = { sheet: sheet.kind, group, page, page_size: PAGE_SIZE };
    api.get("/api/admin/site-master/uploads/{upload_id}/rows", { path, query })
      .then((loaded) => {
        if (stale) {
          return;
        }
        setData({ total: loaded.total, items: loaded.items as unknown as Row[] });
        setError(null);
      })
      .catch((caught) => {
        if (!stale) {
          setError(errorText(caught, "Could not load rows."));
        }
      });
    return () => {
      stale = true;
    };
  }, [uploadId, sheet.kind, sheet.found, group, page]);

  const chooseGroup = (next: Group) => {
    setGroup(next);
    setPage(1);
  };
  return { group, page, setPage, data, error, chooseGroup };
}

// Site master upload: pick a workbook, preview its Sites sheet, choose an override when needed, apply.
export function useSiteMasterUpload() {
  const [uploads, setUploads] = useState<Uploads | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmingSheet, setConfirming] = useState<Sheet | null>(null);
  const [result, setResult] = useState<Applied | null>(null);
  const [addOnly, setAddOnly] = useState(false);

  const loadCurrent = useCallback(() => {
    api.get("/api/admin/site-master/current")
      .then((loaded) => setUploads(loaded as unknown as Uploads))
      .catch(() => {});
  }, []);
  useEffect(loadCurrent, [loadCurrent]);

  const resetPreview = () => {
    setResult(null);
    setStaged(null);
    setConfirming(null);
    setOverride(false);
    setReason("");
  };

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    resetPreview();
    try {
      const options = { add_only: String(addOnly) };
      const uploaded = await api.postFile("/api/admin/site-master/uploads", file, options);
      setStaged(uploaded as Staged);
      loadCurrent();
    } catch (caught) {
      setError(uploadError(caught));
    } finally {
      setBusy(false);
    }
  };

  const sheets = staged?.sheets ?? [];
  const overriding = (sheet: Sheet) => sheet.needs_override && override;

  // Why the Apply button of a sheet is disabled, or null when it can be applied.
  const why = (sheet: Sheet): string | null => {
    if (!willApply(sheet, override)) {
      return "Tick Override to apply this sheet.";
    }
    if (overriding(sheet) && !reason.trim()) {
      return "Enter a reason for the override.";
    }
    return null;
  };

  const applyBody = (sheet: Sheet) => {
    return {
      sheets: [sheet.kind],
      override_drop: { sites: override },
      reason: overriding(sheet) ? reason.trim() : null,
    };
  };

  const apply = async (sheet: Sheet) => {
    if (!staged) {
      return;
    }
    setError(null);
    try {
      const applied = await api.post("/api/admin/site-master/uploads/{upload_id}/apply", {
        path: { upload_id: staged.upload_id },
        body: applyBody(sheet),
      });
      setConfirming(null);
      setStaged(null);
      setResult(applied);
      loadCurrent();
    } catch (caught) {
      setConfirming(null);
      setError(errorText(caught, "Apply failed. Nothing was changed. Try again."));
    }
  };

  const discard = () => {
    setStaged(null);
  };

  return {
    uploads,
    staged,
    busy,
    error,
    override,
    reason,
    result,
    addOnly,
    setAddOnly,
    sheets,
    confirmingSheet,
    setConfirming,
    overriding,
    why,
    pick,
    apply,
    discard,
    setOverride,
    setReason,
  };
}

export type SiteMasterUploadState = ReturnType<typeof useSiteMasterUpload>;
