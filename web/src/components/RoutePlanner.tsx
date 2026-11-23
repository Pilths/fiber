import { useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { db } from "@/lib/status";
import type { Endpoint, RouteOption, RoutePlanner, RouteSegment, Sort } from "@/lib/useRoutePlanner";
import { formatKm } from "@/lib/format";

const LINK_CLASS = "cursor-pointer text-body font-semibold text-blue hover:underline";
const SORT_CHOICES: readonly (readonly [Sort, string])[] = [
  ["km", "Shortest distance"],
  ["free_cores", "Most free cores"],
];
const SORT_CLASS =
  "relative flex cursor-pointer items-center justify-center px-2 font-medium whitespace-nowrap " +
  "has-checked:bg-foreground has-checked:font-semibold has-checked:text-white " +
  "has-focus-visible:z-10 has-focus-visible:outline-3 has-focus-visible:outline-blue";
const OPTION_CLASS =
  "flex w-full items-start gap-2.5 rounded-md border border-line px-3 py-2.5 text-left text-body " +
  "hover:bg-ground focus-visible:-outline-offset-3 aria-pressed:border-blue aria-pressed:bg-blue-bg";
const RADIO_DOT_CLASS = "mt-[3px] grid size-4 flex-none place-items-center rounded-full border-2 bg-white";

function totalKm(option: RouteOption): string {
  const plus = option.distance_incomplete ? "+" : "";
  return `${formatKm(option.total_km)}${plus}`;
}

// Screen-reader words after the lowest-free pill, so a short option is not shown by colour alone.
function shortWords(segment: RouteSegment, need: number): string {
  if (segment.health === "not_verified") {
    return `, ${segment.name} not verified`;
  }
  if (segment.health === "cut") {
    return `, ${segment.name} cut`;
  }
  return `, not enough for ${need}`;
}

function FreePill({ option, short, need }: {
  option: RouteOption;
  short: RouteSegment | undefined;
  need: number;
}) {
  if (!short) {
    return <span className="pill h-plain">{option.fewest_free} free</span>;
  }
  return (
    <span className="pill h-red" data-testid="route-short">
      <Icon name="fl" className="ic" />
      {option.fewest_free} free
      <span className="sr-only">{shortWords(short, need)}</span>
    </span>
  );
}

function siteProblem(from: Endpoint | null, to: Endpoint | null): string | null {
  if (!from || !to) {
    return "Choose sites from the list";
  }
  if (from.id === to.id) {
    return "Choose two different sites";
  }
  return null;
}

// The one message under the form: a typing problem first, then server errors, then "no route".
function formMessage(planner: RoutePlanner, typingError: string | null): string | null {
  const noRoute = planner.index != null && planner.result?.options.length === 0;
  const errors = planner.errors;
  const fieldError = typingError ?? errors.from ?? errors.to ?? errors.cores_needed ?? errors.form;
  if (fieldError != null) {
    return fieldError;
  }
  if (noRoute) {
    return planner.result?.message ?? "No route found";
  }
  return null;
}

function SortChoice({ planner }: { planner: RoutePlanner }) {
  return (
    <div role="radiogroup" aria-label="Optimise for"
      className="grid h-9 grid-cols-2 overflow-hidden rounded-md border border-line">
      {SORT_CHOICES.map(([value, label], i) => (
        <label key={value} className={`${SORT_CLASS} ${i ? "border-l border-line" : ""}`}>
          <input type="radio" name="route-sort" className="absolute size-px opacity-0"
            checked={planner.sort === value} onChange={() => planner.setSort(value)} />
          {label}
        </label>
      ))}
    </div>
  );
}

// "Site A to B" panel beside the map (prototype 9e): sites, cores needed, Find route, sort, then the options.
// Find route picks the best (first) option; the options below show all and scroll inside the space left
// above `filters` (the map filters, pinned to the panel's foot).
export function RouteSearch({ planner, filters }: { planner: RoutePlanner; filters?: ReactNode }) {
  const [typingError, setTypingError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = siteProblem(planner.from, planner.to);
    setTypingError(problem);
    if (!problem) {
      planner.select(0);
    }
  };
  const swap = () => {
    const oldFrom = planner.fromText;
    const picked = planner.index != null;
    planner.setFrom(planner.toText);
    planner.setTo(oldFrom);
    if (picked) {
      planner.select(0);
    }
  };
  const typeFrom = (text: string) => {
    setTypingError(null);
    planner.setFrom(text);
  };
  const typeTo = (text: string) => {
    setTypingError(null);
    planner.setTo(text);
  };
  const message = formMessage(planner, typingError);
  return (
    <section className="card absolute inset-0 flex flex-col overflow-auto" aria-labelledby="route-h">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="route-h" className="card-title">Site A to B</h2>
        {planner.index != null && (
          <button type="button" className={LINK_CLASS} onClick={planner.reset}>Clear route</button>
        )}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label>
          <span className="lbl">Site A</span>
          <input id="route-a" className="field" list="route-sites" value={planner.fromText}
            onChange={(event) => typeFrom(event.target.value)} autoComplete="off" />
        </label>
        <div>
          {/* Swap sits on Site B's label line so every field keeps the panel's full width. */}
          <div className="flex items-end justify-between">
            <label htmlFor="route-b" className="lbl">Site B</label>
            <button type="button" className={`mb-1 ${LINK_CLASS}`} onClick={swap} aria-label="Swap A and B">
              &#8645; Swap
            </button>
          </div>
          <input id="route-b" className="field" list="route-sites" value={planner.toText}
            onChange={(event) => typeTo(event.target.value)} autoComplete="off" />
        </div>
        <label>
          <span className="lbl">Cores needed</span>
          <input type="number" min={1} inputMode="numeric" className="field" value={planner.coresText}
            onChange={(event) => planner.setCores(event.target.value)} />
        </label>
        <button type="submit" className="btn btn-p w-full border-blue! bg-blue! hover:brightness-95"
          disabled={!planner.sites.length}>
          Find route
        </button>
        <SortChoice planner={planner} />
        {message && (
          <p role="status" data-testid="route-found" className="font-semibold text-red">{message}</p>
        )}
        <datalist id="route-sites">
          {planner.sites.map((site) => <option key={site.id} value={site.name} />)}
        </datalist>
      </form>
      <RouteOptions planner={planner} />
      {filters}
    </section>
  );
}

function OptionCard({ option, number, selected, need, onSelect }: {
  option: RouteOption;
  number: number;
  selected: boolean;
  need: number;
  onSelect: () => void;
}) {
  const short = option.insufficient ? option.segments.find((segment) => segment.short) : undefined;
  const segmentWord = option.total_segments === 1 ? "segment" : "segments";
  const loss = option.estimated_db == null ? "-" : db(option.estimated_db);
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} data-testid="route-option"
      className={OPTION_CLASS}>
      <span aria-hidden className={`${RADIO_DOT_CLASS} ${selected ? "border-blue" : "border-line"}`}>
        {selected && <span className="size-2 rounded-full bg-blue" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <b className="text-sm font-semibold">Option {number}</b>
          {option.best_match && <span className="pill h-blue">Best match</span>}
        </span>
        <span className="mt-1 flex items-center justify-between gap-2">
          <span>{option.total_segments} {segmentWord}, {totalKm(option)} km</span>
          <FreePill option={option} short={short} need={need} />
        </span>
        <span className="block">Calculated loss {loss}</span>
      </span>
    </button>
  );
}

// The options under Find route (as many as the network gives, up to 5).
// A click draws that option on the map and the diagram.
function RouteOptions({ planner }: { planner: RoutePlanner }) {
  const options = planner.result?.options ?? [];
  if (planner.index == null || !options.length) {
    return null;
  }
  const need = planner.need ?? 1;
  return (
    <section className="my-2 min-h-0 flex-1 overflow-y-auto" aria-label="Route options">
      <ul aria-label="Route options" className="flex flex-col gap-2">
        {options.map((option, i) => (
          <li key={i}>
            <OptionCard option={option} number={i + 1} selected={planner.index === i} need={need}
              onSelect={() => planner.select(i)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
