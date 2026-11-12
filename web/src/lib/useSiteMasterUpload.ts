import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { PAGE_SIZE } from "@/components/upload-parts";
import { uploadError } from "@/lib/utils";

export type Staged = components["schemas"]["app__ingest__site_master_router__UploadOut"];
export type Sheet = components["schemas"]["SheetOut"];
export type Applied = components["schemas"]["app__ingest__site_master_router__ApplyOut"];
export type Kind = Sheet["kind"];
export type Group = "added" | "changed" | "missing" | "problem" | "unchanged";
export type Decision = "rename" | "separate";
export type Rename = {
  missing_dc_id: number;
  missing_dc_name: string;
  new_dc_name: string;
  new_row_number: number;
  new_row_id: number;
  lrd: string | null;
};
export type Row = {
  id: number;
  row_number: number | null;
  key: string;
  status: string | null;
  reason: string | null;
  changes: { field: string; old: unknown; new: unknown; protected?: boolean; note?: string }[];
  location_note: string | null;
  in_use: boolean | null;
  possible_rename: Rename | null;
  raw: Record<string, unknown> | null;
  parsed: {
    lat?: number | null;
    lon?: number | null;
    lrd?: string | null;
    details?: Record<string, unknown>;
  } | null;
};
export type FileInfo = {
  upload_id: number;
  filename: string;
  status: string;
  uploaded_at: string;
  applied_at: string | null;
  uploaded_by: string;
  sheets: Partial<Record<Kind, { sheet_name: string | null; found: boolean; rows: number }>>;
};
export type Uploads = { current: FileInfo | null; previous: FileInfo[] };
type RowPage = { total: number; items: Row[] };

const NO_OVERRIDE: Record<Kind, boolean> = { sites: false, dcs: false };
const NO_REASON: Record<Kind, string> = { sites: "", dcs: "" };

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

// Site master upload: pick a workbook, preview its sheets, decide renames and overrides, apply sheet by sheet.
export function useSiteMasterUpload() {
  const [uploads, setUploads] = useState<Uploads | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<Kind, boolean>>(NO_OVERRIDE);
  const [reason, setReason] = useState<Record<Kind, string>>(NO_REASON);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [confirming, setConfirming] = useState<Kind | null>(null);
  // sheets applied from this upload while others remain
  const [done, setDone] = useState<Partial<Record<Kind, Applied>>>({});
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
    setDone({});
    setConfirming(null);
    setOverride(NO_OVERRIDE);
    setReason(NO_REASON);
    setDecisions({});
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
  const renames = (staged?.possible_renames ?? []) as Rename[];
  const undecided = renames.filter((rename) => !decisions[rename.missing_dc_id]).length;
  const overriding = (sheet: Sheet) => sheet.needs_override && override[sheet.kind];

  // Why the Apply button of a sheet is disabled, or null when it can be applied.
  const why = (sheet: Sheet): string | null => {
    if (!willApply(sheet, override[sheet.kind])) {
      return "Tick Override to apply this sheet.";
    }
    if (sheet.kind === "dcs" && undecided) {
      const renamesWord = undecided === 1 ? "rename" : "renames";
      return `Choose Rename or Keep separate for ${undecided} possible ${renamesWord}.`;
    }
    if (overriding(sheet) && !reason[sheet.kind].trim()) {
      return "Enter a reason for the override.";
    }
    return null;
  };

  // DC rows find their LRD among sites already saved, so a new Site Location sheet should go first.
  const sitesFound = sheets.some((sheet) => sheet.kind === "sites" && sheet.found);
  const sitesPending = sitesFound && !done.sites;

  const applyBody = (kind: Kind, sheet: Sheet) => {
    const renameDecisions = renames.map((rename) => ({
      missing_dc_id: rename.missing_dc_id,
      new_row_id: rename.new_row_id,
      decision: decisions[rename.missing_dc_id],
    }));
    return {
      sheets: [kind],
      override_drop: { sites: kind === "sites" && override.sites, dcs: kind === "dcs" && override.dcs },
      reason: overriding(sheet) ? reason[kind].trim() : null,
      renames: kind === "dcs" ? renameDecisions : [],
    };
  };

  const apply = async (kind: Kind) => {
    const sheet = sheets.find((candidate) => candidate.kind === kind);
    if (!staged || !sheet) {
      return;
    }
    setError(null);
    try {
      const applied = await api.post("/api/admin/site-master/uploads/{upload_id}/apply", {
        path: { upload_id: staged.upload_id },
        body: applyBody(kind, sheet),
      });
      setConfirming(null);
      if (applied.complete) {
        setStaged(null);
        setDone({});
        const earlierWarnings = Object.values(done).flatMap((sheetResult) => sheetResult.warnings);
        setResult({ ...applied, warnings: [...earlierWarnings, ...applied.warnings] });
      } else {
        setDone((current) => ({ ...current, [kind]: applied }));
        // the Apply button is gone, so focus moves to the applied note
        requestAnimationFrame(() => document.getElementById(`sm-${kind}-done`)?.focus());
      }
      loadCurrent();
    } catch (caught) {
      setConfirming(null);
      setError(errorText(caught, "Apply failed. Nothing was changed. Try again."));
    }
  };

  const discard = () => {
    setStaged(null);
    setDone({});
  };
  const decide = (id: number, decision: Decision) => {
    setDecisions((current) => ({ ...current, [id]: decision }));
  };
  const setSheetOverride = (kind: Kind, on: boolean) => {
    setOverride((current) => ({ ...current, [kind]: on }));
  };
  const setSheetReason = (kind: Kind, text: string) => {
    setReason((current) => ({ ...current, [kind]: text }));
  };
  const confirmingSheet = sheets.find((sheet) => sheet.kind === confirming);

  return {
    uploads,
    staged,
    busy,
    error,
    override,
    reason,
    decisions,
    done,
    result,
    addOnly,
    setAddOnly,
    sheets,
    renames,
    sitesPending,
    confirmingSheet,
    setConfirming,
    overriding,
    why,
    pick,
    apply,
    discard,
    decide,
    setSheetOverride,
    setSheetReason,
  };
}

export type SiteMasterUploadState = ReturnType<typeof useSiteMasterUpload>;
