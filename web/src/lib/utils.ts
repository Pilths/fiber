import { ApiError, errorText } from "@/api/client";


export const uploadError = (e: unknown) =>
  e instanceof ApiError && e.status === 413 ? "The file is larger than 20 MB. Split it or remove unused sheets, then upload again."
    : errorText(e, "Upload failed. Check the file is an .xlsx workbook and try again.");

// Parsed value first; a value the parser could not read (e.g. "TBA") shows as typed in the file.
export const field = (o: Record<string, unknown> | null | undefined, re: RegExp) => {
  const k = o && Object.keys(o).find((x) => re.test(x.trim()));
  return k ? o[k] : null;
};
export const cell = (parsed: unknown, raw: unknown) => {
  const v = parsed ?? raw;
  return v == null || v === "" ? "—" : String(v);
};

// For best-effort calls (refresh, clipboard, fullscreen) whose failure the user does not need to see.
export function ignoreFailure(): void {
  // Nothing to do: the screen keeps what it already shows.
}
