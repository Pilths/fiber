import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { useCloseOnOutsideClick } from "@/lib/useCloseOnOutsideClick";

export type SearchResult = components["schemas"]["SearchResult"];
type Result = SearchResult;

const GROUPS: Result["type"][] = ["customer", "segment", "core"];
const GROUP_LABEL = { customer: "Customers", segment: "Segments", core: "Cores" };
const SEARCH_LABEL = "Find a segment, site, customer or core";
const SEARCH_DELAY_MS = 200;

const LIST_CLASS =
  "absolute inset-x-0 top-[42px] z-30 max-h-[440px] overflow-auto " +
  "rounded-xl border border-line bg-white py-2";
const OPTION_CLASS = "flex min-h-10 cursor-pointer items-center px-4 py-1.5 aria-disabled:cursor-not-allowed";
const MUTED_LINE_CLASS = "px-4 py-2 text-body text-muted-foreground";

// Results come from GET /api/search, grouped in GROUPS order. Typing waits SEARCH_DELAY_MS before asking.
function useGlobalSearch(onPick: (result: Result) => void) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const found = await api.get("/api/search", { query: { q: term } });
        if (stale) {
          return;
        }
        setError(false);
        setResults(GROUPS.flatMap((group) => found.filter((result) => result.type === group)));
        setActive(0);
      } catch {
        if (!stale) {
          setError(true);
        }
      }
    }, SEARCH_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const type = (text: string) => {
    setQuery(text);
    setOpen(true);
    if (!text.trim()) {
      setResults([]);
    }
  };

  const pick = (result: Result) => {
    // nothing to open (e.g. a customer without reservations)
    if (result.segment_id == null) {
      return;
    }
    setOpen(false);
    setQuery("");
    setResults([]);
    onPick(result);
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (results.length) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) => (current + step + results.length) % results.length);
      }
    } else if (event.key === "Enter" && open && results[active]) {
      event.preventDefault();
      pick(results[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && query.trim() !== "";
  return { query, results, active, setActive, error, showList, setOpen, type, pick, onKey };
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true"
      className="ni pointer-events-none absolute left-3 top-2.5 text-muted-foreground">
      <path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5" />
    </svg>
  );
}

function SearchGroup({ id, group, results, active, onHover, onPick }: {
  id: string;
  group: Result["type"];
  results: Result[];
  active: number;
  onHover: (index: number) => void;
  onPick: (result: Result) => void;
}) {
  const numbered = results.map((result, index) => ({ result, index }));
  const items = numbered.filter((item) => item.result.type === group);
  if (!items.length) {
    return null;
  }
  return (
    <div role="group" aria-label={GROUP_LABEL[group]}>
      <div className="lbl px-4 pt-2">{GROUP_LABEL[group]}</div>
      {items.map(({ result, index }) => (
        <div
          key={index}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === active}
          aria-disabled={result.segment_id == null}
          onMouseEnter={() => onHover(index)}
          onClick={() => onPick(result)}
          className={`${OPTION_CLASS} ${index === active ? "bg-blue-bg" : ""}`}
        >
          <span className="font-semibold">{result.label}</span>
          {result.segment_id == null && (
            <span className="ml-2 text-body text-muted-foreground">(no segment yet)</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function GlobalSearch({ onPick }: { onPick: (result: Result) => void }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const search = useGlobalSearch(onPick);
  useCloseOnOutsideClick(box, true, () => search.setOpen(false));

  const activeId = search.showList && search.results[search.active] ? `${id}-${search.active}` : undefined;
  const noMatches = !search.error && search.results.length === 0;
  return (
    <div ref={box} className="relative ml-auto min-w-[260px] flex-[0_1_420px]">
      <SearchIcon />
      <input
        id="global-search"
        role="combobox"
        aria-label={SEARCH_LABEL}
        aria-expanded={search.showList}
        aria-controls={`${id}-list`}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        placeholder={SEARCH_LABEL}
        className="field pl-9"
        value={search.query}
        onChange={(event) => search.type(event.target.value)}
        onFocus={() => search.setOpen(true)}
        onKeyDown={search.onKey}
      />
      {search.showList && (
        <div id={`${id}-list`} role="listbox" aria-label="Search results" className={LIST_CLASS}>
          {search.error && <p className={MUTED_LINE_CLASS}>Search failed. Try again.</p>}
          {noMatches && <p className={MUTED_LINE_CLASS}>No matches.</p>}
          {GROUPS.map((group) => (
            <SearchGroup key={group} id={id} group={group} results={search.results} active={search.active}
              onHover={search.setActive} onPick={search.pick} />
          ))}
        </div>
      )}
    </div>
  );
}
