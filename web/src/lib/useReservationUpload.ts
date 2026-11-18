import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { uploadError } from "@/lib/utils";

export type ReservationPreview = components["schemas"]["StagedOut"];
export type ImportState = components["schemas"]["ImportStateOut"];
type Result = components["schemas"]["ConfirmOut"];
type Win = components["schemas"]["WinIn"];

// A ticked "Use Excel value" box is kept as "rowId:field".
export const winKey = (rowId: number, field: string) => `${rowId}:${field}`;

function winsBody(wins: Set<string>): Win[] {
  return [...wins].map((key) => {
    const [rowId, field] = key.split(":");
    return { row_id: Number(rowId), field: field as Win["field"] };
  });
}

// Reservation workbook upload: the import switch, pick a workbook, preview, choose Excel wins, confirm.
export function useReservationUpload() {
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [preview, setPreview] = useState<ReservationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wins, setWins] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const confirmingNow = useRef(false);

  const loadImportState = useCallback(() => {
    api.get("/api/admin/reservation-import")
      .then(setImportState)
      .catch(() => {});
  }, []);
  useEffect(loadImportState, [loadImportState]);

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    setPreview(null);
    setWins(new Set());
    try {
      setPreview(await api.postFile("/api/admin/uploads", file));
    } catch (caught) {
      setError(uploadError(caught));
    } finally {
      setBusy(false);
    }
  };

  // A double click on Confirm sends one request.
  const confirm = async () => {
    if (!preview || confirmingNow.current) {
      return;
    }
    confirmingNow.current = true;
    try {
      const path = { upload_id: preview.upload_id };
      const body = { excel_wins: winsBody(wins) };
      const confirmed = await api.post("/api/admin/uploads/{upload_id}/confirm", { path, body });
      setPreview(null);
      setResult(confirmed);
    } catch (caught) {
      setError(errorText(caught, "Confirm failed. Nothing was saved. Try again."));
    } finally {
      confirmingNow.current = false;
      setConfirming(false);
    }
  };

  const setWin = (key: string, on: boolean) => {
    setWins((current) => {
      const next = new Set(current);
      if (on) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const discard = () => {
    setPreview(null);
  };

  return {
    importState, setImportState,
    preview, busy, error, result, pick, discard,
    wins, setWin,
    confirming, setConfirming, confirm,
  };
}
