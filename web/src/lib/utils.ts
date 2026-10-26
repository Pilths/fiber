import { ApiError, errorText } from "@/api/client";

export { cn } from "cn"

export const when = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";

export const uploadError = (e: unknown) =>
  e instanceof ApiError && e.status === 413 ? "The file is larger than 20 MB. Split it or remove unused sheets, then upload again."
    : errorText(e, "Upload failed. Check the file is an .xlsx workbook and try again.");
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
