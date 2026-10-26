import type { components } from "@/api/schema";
import type { IconName } from "@/components/Icon";

export type CoreStatus = components["schemas"]["CoreDetail"]["status"];

// Icon + word per status; the cell pattern lives in index.css (.core-*). Never colour alone.
export const STATUS: Record<CoreStatus, { icon: IconName; cls: string; tone: string }> = {
  Available: { icon: "av", cls: "core-available", tone: "text-muted-foreground" },
  Requested: { icon: "rq", cls: "core-requested", tone: "text-amber" },
  Reserved: { icon: "rs", cls: "core-reserved", tone: "text-foreground" },
  "In use": { icon: "iu", cls: "core-inuse", tone: "text-[#50555d]" },
  Faulty: { icon: "fl", cls: "core-faulty", tone: "text-red" },
};
export const STATUS_ORDER = Object.keys(STATUS) as CoreStatus[];

type Health = { cls: string; icon: IconName; word: string; value: string };
// Free-to-reserve health: green 10+, amber 1-9, red 0 (full), grey dashed when not surveyed.
export function health(s: { survey_cores: number | null; free_to_reserve: number }): Health {
  if (s.survey_cores == null) return { cls: "h-ns", icon: "ns", word: "Not surveyed", value: "not surveyed" };
  const n = s.free_to_reserve;
  if (n >= 10) return { cls: "h-green", icon: "ch", word: "Healthy", value: String(n) };
  if (n > 0) return { cls: "h-amber", icon: "lo", word: "Low", value: String(n) };
  return { cls: "h-red", icon: "fl", word: "Full", value: "0 full" };
}

export const countBy = (d: { cores: { status: CoreStatus }[] }) => {
  const n: Record<CoreStatus, number> = { Available: 0, Requested: 0, Reserved: 0, "In use": 0, Faulty: 0 };
  for (const c of d.cores) n[c.status]++;
  return n;
};

export const spanName = (s: { site_a: string; site_b: string }) => `${s.site_a} - ${s.site_b}`;

export const inputCls =
  "h-9 rounded-md border border-line bg-white px-3 text-sm outline-none focus-visible:outline-3 focus-visible:outline-blue";
