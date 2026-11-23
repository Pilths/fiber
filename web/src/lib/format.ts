// Date and number formatting for display. Dates show in Asia/Kuala_Lumpur, whatever the browser's zone.

const TIME_ZONE = "Asia/Kuala_Lumpur";
const EMPTY = "—";

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const DATE = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short" });
const ISO_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// A date-only value ("2026-11-19") is a Kuala Lumpur calendar day: read as midnight there, not UTC midnight,
// so it never shifts a day.
function toDate(value: string): Date {
  if (DATE_ONLY.test(value)) {
    return new Date(`${value}T00:00:00+08:00`);
  }
  return new Date(value);
}

// "26 Oct 2026, 14:05", or a dash when there is no value.
export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return EMPTY;
  }
  return DATE_TIME.format(toDate(value));
}

// "26 Oct 2026", or a dash when there is no value.
export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return EMPTY;
  }
  return DATE.format(toDate(value));
}

// "12 Mar", for the customer request picker.
export function formatShortDate(value: string): string {
  return SHORT_DATE.format(toDate(value));
}

// Today in Kuala Lumpur as "2026-11-19", the value of a date input.
export function todayIso(): string {
  return ISO_DAY.format(new Date());
}

// "1,204 rows", "1 core"; `many` for an irregular plural.
export function plural(count: number, one: string, many = `${one}s`): string {
  const word = count === 1 ? one : many;
  return `${count.toLocaleString("en-GB")} ${word}`;
}

// Kilometres to one decimal, trailing zero dropped ("18.2", "7"), or a dash when unknown.
export function formatKm(km: number | null | undefined): string {
  if (km == null) {
    return EMPTY;
  }
  return String(Number(km.toFixed(1)));
}

// "3 lines · 2 areas · 6 points", zero parts left out.
export function elementCounts(counts: { lines: number; areas: number; points: number }): string {
  const parts = [];
  if (counts.lines > 0) {
    parts.push(plural(counts.lines, "line"));
  }
  if (counts.areas > 0) {
    parts.push(plural(counts.areas, "area"));
  }
  if (counts.points > 0) {
    parts.push(plural(counts.points, "point"));
  }
  return parts.join(" · ");
}
