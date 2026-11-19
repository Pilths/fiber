import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { uploadError } from "@/lib/utils";

export type Staged = components["schemas"]["app__ingest__site_master_router__UploadOut"];
export type Sheet = components["schemas"]["SheetOut"];
export type Applied = components["schemas"]["app__ingest__site_master_router__ApplyOut"];
export type Group = Exclude<keyof Sheet["counts"], "rows">;
export type Row = components["schemas"]["RowItem"];
export type FileInfo = components["schemas"]["UploadInfo"];
export type Uploads = components["schemas"]["CurrentOut"];

function willApply(sheet: Sheet, override: boolean): boolean {
  return sheet.found && (!sheet.blocked || (sheet.needs_override && override));
}

// Site master upload: pick a workbook, preview its Sites sheet, choose an override when needed, apply.
export function useSiteMasterUpload() {
  const [uploads, setUploads] = useState<Uploads | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [confirmingSheet, setConfirming] = useState<Sheet | null>(null);
  const [result, setResult] = useState<Applied | null>(null);
  const [addOnly, setAddOnly] = useState(false);
  const applying = useRef(false);

  const loadCurrent = useCallback(() => {
    api.get("/api/admin/site-master/current")
      .then(setUploads)
      .catch(() => {});
  }, []);
  useEffect(loadCurrent, [loadCurrent]);

  const resetPreview = () => {
    setResult(null);
    setStaged(null);
    setConfirming(null);
    setOverride(false);
    setRemarks("");
  };

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    resetPreview();
    try {
      const options = { add_only: String(addOnly) };
      setStaged(await api.postFile("/api/admin/site-master/uploads", file, options));
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
    return null;
  };

  const applyBody = (sheet: Sheet) => {
    return {
      sheets: [sheet.kind],
      override_drop: { sites: override },
      remarks: overriding(sheet) ? remarks.trim() : "",
    };
  };

  // A double click on Apply sends one request.
  const apply = async (sheet: Sheet) => {
    if (!staged || applying.current) {
      return;
    }
    applying.current = true;
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
    } finally {
      applying.current = false;
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
    remarks,
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
    setRemarks,
  };
}

export type SiteMasterUploadState = ReturnType<typeof useSiteMasterUpload>;
