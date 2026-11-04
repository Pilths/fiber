import type { components } from "@/api/schema";
import type { IconName } from "@/components/Icon";

export type CoreStatus = components["schemas"]["CoreDetail"]["status"];

// Icon + word per status; the cell pattern lives in index.css (.core-*). Never colour alone.
export const STATUS: Record<CoreStatus, { icon: IconName; cls: string; tone: string }> = {
  Available: { icon: "av", cls: "core-available", tone: "text-muted-foreground" },
  Requested: { icon: "rq", cls: "core-requested", tone: "text-amber" },
  Reserved: { icon: "rs", cls: "core-reserved", tone: "text-foreground" },
  "In use": { icon: "iu", cls: "core-inuse", tone: "text-use" },
};
// The API and the data keep "In use"; the screens say "In service".
export const statusLabel = (s: string) => (s === "In use" ? "In service" : s);

type Health = { cls: string; icon: IconName; word: string; value: string };
// Free-to-reserve health: red "Cut" when the cable is cut, green 10+, amber 1-9, red 0 (full), grey dashed when not surveyed.
export function health(s: { survey_cores: number | null; free_to_reserve: number; fiber_cut?: boolean }): Health {
  if (s.fiber_cut) return { cls: "h-red", icon: "fl", word: "Cut", value: "0 cut" };
  if (s.survey_cores == null) return { cls: "h-ns", icon: "ns", word: "Not surveyed", value: "not surveyed" };
  const n = s.free_to_reserve;
  if (n >= 10) return { cls: "h-green", icon: "ch", word: "Healthy", value: String(n) };
  if (n > 0) return { cls: "h-amber", icon: "lo", word: "Low", value: String(n) };
  return { cls: "h-red", icon: "fl", word: "Full", value: "0 full" };
}

// Map filter (Region) lives in the Dashboard; q stays "" now that the header search finds segments.
// Route types and site kinds are map Layers, not a filter.
export type SegmentFilter = { q: string; region: string };
export const NO_FILTER: SegmentFilter = { q: "", region: "" };

export function inFilter(segment: { region: string | null }, filter: SegmentFilter): boolean {
  return !filter.region || segment.region === filter.region;
}

export const segmentName = (s: { site_a: string; site_b: string }) => `${s.site_a} - ${s.site_b}`;

export const inputCls =
  "h-9 rounded-md border border-line bg-white px-3 text-sm outline-none focus-visible:outline-3 focus-visible:outline-blue";

export type LossDetail = components["schemas"]["SegmentLossDetail"];
export const db = (n: number) => `${n.toFixed(2)} dB`;

// Date and time in Asia/Kuala_Lumpur, e.g. "26 Oct 2026, 14:05".
export const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

// Reservation event types in plain words ("Approved by DEV admin1").
export const EVENT_WORD: Record<string, string> = {
  requested: "Requested", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", kept: "Kept",
  release_requested: "Release requested", released: "Released", release_declined: "Release declined", corrected: "Corrected", assigned: "Cores assigned",
};
