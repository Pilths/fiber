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
export const statusLabel = (status: string) => (status === "In use" ? "In service" : status);

export type SegmentHealth = components["schemas"]["SegmentSummary"]["health"];
type Health = { cls: string; word: string; value: string };

// Free-to-reserve health, decided by the API: a free count is a plain number, 0 is red "Full", a cut cable
// red "Cut", not verified grey dashed. `word` is for screen readers, `value` is what shows.
export function health(segment: { health: SegmentHealth; free_to_reserve: number }): Health {
  if (segment.health === "cut") {
    return { cls: "h-red", word: "Cut", value: "Cut" };
  }
  if (segment.health === "not_verified") {
    return { cls: "h-ns", word: "Not verified", value: "Not verified" };
  }
  if (segment.health === "full") {
    return { cls: "h-red", word: "Full", value: "Full" };
  }
  return { cls: "h-plain", word: "free to reserve", value: String(segment.free_to_reserve) };
}

// Map filter (Region) lives in the Dashboard; q stays "" now that the header search finds segments.
// Route types and site kinds are map Layers, not a filter.
export type SegmentFilter = { q: string; region: string };
export const NO_FILTER: SegmentFilter = { q: "", region: "" };

export function inFilter(segment: { region: string | null }, filter: SegmentFilter): boolean {
  return !filter.region || segment.region === filter.region;
}

export const segmentName = (segment: { site_a: string; site_b: string }) =>
  `${segment.site_a} - ${segment.site_b}`;

export const inputCls =
  "h-9 rounded-md border border-line bg-white px-3 text-sm outline-none " +
  "focus-visible:outline-3 focus-visible:outline-blue";

export type LossDetail = components["schemas"]["SegmentLossDetail"];
export const db = (decibels: number) => `${decibels.toFixed(2)} dB`;

// Reservation event types in plain words ("Approved by DEV admin1").
export const EVENT_WORD: Record<string, string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  kept: "Kept",
  release_requested: "Release requested",
  released: "Released",
  release_declined: "Release declined",
  corrected: "Corrected",
  assigned: "Cores assigned",
};
