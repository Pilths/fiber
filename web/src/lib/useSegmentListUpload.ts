import { useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { uploadError } from "@/lib/utils";

export type SegmentListStaged = components["schemas"]["app__ingest__segment_list_router__UploadOut"];
type Applied = components["schemas"]["app__ingest__segment_list_router__ApplyOut"];

// Segment list upload: pick a workbook, preview its rows, apply.
export function useSegmentListUpload() {
  const [staged, setStaged] = useState<SegmentListStaged | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Applied | null>(null);
  const applying = useRef(false);

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    setStaged(null);
    setConfirming(false);
    try {
      setStaged(await api.postFile("/api/admin/segment-list/uploads", file));
    } catch (caught) {
      setError(uploadError(caught));
    } finally {
      setBusy(false);
    }
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
      setResult(await api.post("/api/admin/segment-list/uploads/{upload_id}/apply", { path }));
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

  return { staged, busy, error, confirming, setConfirming, result, pick, apply, discard };
}
