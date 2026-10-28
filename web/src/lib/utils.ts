import { ApiError, errorText } from "@/api/client";

export { cn } from "cn"

export const when = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";

export const uploadError = (e: unknown) =>
  e instanceof ApiError && e.status === 413 ? "The file is larger than 20 MB. Split it or remove unused sheets, then upload again."
    : errorText(e, "Upload failed. Check the file is an .xlsx workbook and try again.");
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

// Parsed value first; a value the parser could not read (e.g. "TBA") shows as typed in the file.
export const field = (o: Record<string, unknown> | null | undefined, re: RegExp) => {
  const k = o && Object.keys(o).find((x) => re.test(x.trim()));
  return k ? o[k] : null;
};
export const cell = (parsed: unknown, raw: unknown) => {
  const v = parsed ?? raw;
  return v == null || v === "" ? "—" : String(v);
};
