import type { components } from "@/api/schema";

export type CoreStatus = components["schemas"]["CoreDetail"]["status"];

// Symbol + text per status; the cell pattern lives in index.css (.core-*). Never colour alone.
export const STATUS: Record<CoreStatus, { symbol: string; cls: string }> = {
  Available: { symbol: "○", cls: "core-available" },
  Requested: { symbol: "◔", cls: "core-requested" },
  Reserved: { symbol: "▨", cls: "core-reserved" },
  "In use": { symbol: "●", cls: "core-inuse" },
  Faulty: { symbol: "✕", cls: "core-faulty" },
};
export const STATUS_ORDER = Object.keys(STATUS) as CoreStatus[];

export const inputCls =
  "h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
