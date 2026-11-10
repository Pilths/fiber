import { useEffect, useId, useRef, useState } from "react";
import { api, DEV_USERS, setDevUser } from "@/api/client";
import type { components } from "@/api/schema";
import { NavIcon } from "@/components/Icon";

type Result = components["schemas"]["SearchResult"];
type Me = components["schemas"]["CurrentUser"];
const GROUPS: Result["type"][] = ["customer", "segment", "circuit", "core"];
const GROUP_LABEL = { customer: "Customers", segment: "Segments", circuit: "Circuits", core: "Cores" };
const SEARCH_LABEL = "Find a segment, site, customer, circuit or core";
const SEARCH_DELAY_MS = 200;

const LIST_CLASS =
  "absolute inset-x-0 top-[42px] z-30 max-h-[440px] overflow-auto " +
  "rounded-xl border border-line bg-white py-2";
const OPTION_CLASS = "flex min-h-10 cursor-pointer items-center px-4 py-1.5 aria-disabled:cursor-not-allowed";
const MENU_CLASS =
  "absolute right-0 top-[50px] z-30 min-w-[220px] rounded-xl border border-line bg-white py-1.5";
const MENU_ITEM_CLASS =
  "block min-h-9 w-full px-3 text-left font-medium hover:bg-raised focus-visible:-outline-offset-3";
const MUTED_LINE_CLASS = "px-4 py-2 text-body text-muted-foreground";
const ACCOUNT_BUTTON_CLASS =
  "flex h-11 items-center gap-2.5 rounded-md pl-1.5 pr-2.5 text-left hover:bg-raised aria-expanded:bg-raised";
const INITIALS_CLASS =
  "grid size-[30px] place-items-center rounded-full bg-res text-xs font-semibold text-white";
const TAB_CLASS =
  "flex h-9 items-center gap-2 rounded-md px-2.5 whitespace-nowrap text-nav-ink hover:bg-raised " +
  "aria-[current=page]:bg-foreground aria-[current=page]:font-semibold aria-[current=page]:text-white";

// Closes a popup when the user presses the mouse anywhere outside it.
function useCloseOnOutsideClick(
  box: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [box, enabled, close]);
}

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

function GlobalSearch({ onPick }: { onPick: (result: Result) => void }) {
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

export type View = "map" | "mine" | "approvals" | "upload" | "users";

const LOGO_DOTS = [[22, 15, 0], [18.5, 21.1, 1], [11.5, 21.1, 0], [8, 15, 0], [11.5, 8.9, 0], [18.5, 8.9, 0]];

export const LOGO = (
  <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
    <circle cx="15" cy="15" r="14" fill="#141414" />
    {LOGO_DOTS.map(([x, y, filled]) => (
      <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill={filled ? "#fff" : "none"}
        stroke="#fff" strokeWidth="1.2" />
    ))}
  </svg>
);

type AccountActions = { onSignOut: () => void; onChangePassword: () => void };

function initialsOf(me: Me): string {
  const fromName = me.display_name.match(/\b\w/g)?.join("");
  return (fromName ?? me.username).slice(0, 2).toUpperCase();
}

function switchDevUser(username: string) {
  setDevUser(username);
  location.reload();
}

type AccountButtonProps = { me: Me; role: string; open: boolean; onToggle: () => void };

function AccountButton({ me, role, open, onToggle }: AccountButtonProps) {
  return (
    <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={onToggle}
      className={ACCOUNT_BUTTON_CLASS}>
      <span aria-hidden className={INITIALS_CLASS}>
        {initialsOf(me)}
      </span>
      <span>
        <b className="block text-body leading-[17px] font-semibold">{me.display_name}</b>
        <small className="sr-only"> {role}</small>
      </span>
      <svg viewBox="0 0 16 16" aria-hidden="true" className="ni"><path d="M4 6l4 4 4-4" /></svg>
    </button>
  );
}

function DevUserPicker({ username }: { username: string }) {
  return (
    <label className="mt-1.5 block border-t px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
      Dev user (development only)
      <select aria-label="Dev user" className="field mt-1 h-8 text-sm text-foreground" value={username}
        onChange={(event) => switchDevUser(event.target.value)}>
        {DEV_USERS.map((user) => <option key={user}>{user}</option>)}
      </select>
    </label>
  );
}

type AccountProps = { me: Me; onView: (view: View) => void } & AccountActions;

function Account({ me, onView, onSignOut, onChangePassword }: AccountProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(box, open, () => setOpen(false));
  useEffect(() => {
    if (open) {
      menu.current?.querySelector<HTMLElement>("button, select")?.focus();
    }
  }, [open]);

  const role = me.role === "admin" ? "Admin" : "Planner";
  const closeThen = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setOpen(false);
      box.current?.querySelector("button")?.focus();
    }
  };
  return (
    <div ref={box} className="relative flex-none" onKeyDown={onKeyDown}>
      <AccountButton me={me} role={role} open={open} onToggle={() => setOpen((current) => !current)} />
      {open && (
        <div ref={menu} role="menu" aria-label="Account" className={MENU_CLASS}>
          <p className="mb-1.5 border-b px-3 pb-2.5 pt-2 text-body whitespace-nowrap text-muted-foreground">
            <b className="font-semibold text-foreground">{me.display_name}</b> · {role}
          </p>
          {me.role === "admin" && (
            <button type="button" role="menuitem" className={MENU_ITEM_CLASS}
              onClick={closeThen(() => onView("users"))}>
              Users
            </button>
          )}
          <button type="button" role="menuitem" className={MENU_ITEM_CLASS}
            onClick={closeThen(onChangePassword)}>
            Change password
          </button>
          <button type="button" role="menuitem" className={MENU_ITEM_CLASS} onClick={closeThen(onSignOut)}>
            Sign out
          </button>
          {import.meta.env.DEV && <DevUserPicker username={me.username} />}
        </div>
      )}
    </div>
  );
}

type Tab = [View, string, string, React.ReactNode];

function Badge({ count, label }: { count: number; label: string }) {
  return <span className="badge">{count}<span className="sr-only"> {label}</span></span>;
}

function tabsFor(admin: boolean, approvals: number | null, stale: number): Tab[] {
  const staleBadge = stale > 0 && <Badge key="badge" count={stale} label="stale" />;
  const tabs: Tab[] = [
    ["map", "Inventory", "M2 4l4-1.5 4 1.5 4-1.5v9.5l-4 1.5-4-1.5-4 1.5zM6 2.5v9.5M10 4v9.5", null],
    ["mine", "My reservations", "M4 2.5h8v11l-4-3-4 3z", staleBadge],
  ];
  if (admin) {
    const waiting = approvals ? <Badge key="badge" count={approvals} label="waiting" /> : null;
    tabs.push(["approvals", "Approvals", "M3 8.5l3 3 7-7", waiting]);
    tabs.push(["upload", "Upload", "M8 11V3M5 6l3-3 3 3M3 13h10", null]);
  }
  return tabs;
}

type HeaderProps = AccountActions & {
  onPick: (result: Result) => void;
  view: View;
  onView: (view: View) => void;
  me: Me | null;
  approvals: number | null;
  stale: number;
};

export function Header(props: HeaderProps) {
  const { onPick, view, onView, me, approvals, stale, onSignOut, onChangePassword } = props;
  const tabs = tabsFor(me?.role === "admin", approvals, stale);
  return (
    <header className="sticky top-0 z-20 flex h-[60px] items-center gap-5 border-b bg-white px-6">
      <div className="flex flex-none items-center gap-2.5">
        {LOGO}
        <h1 className="text-base leading-5 font-semibold">Fiber</h1>
      </div>
      <nav aria-label="Main">
        <ul className="flex items-center gap-0.5">
          {tabs.map(([tabView, label, iconPath, extra]) => (
            <li key={tabView}>
              <button type="button" aria-current={view === tabView ? "page" : undefined}
                onClick={() => onView(tabView)} className={TAB_CLASS}>
                <NavIcon d={iconPath} /><span>{label}</span>{extra}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <GlobalSearch onPick={onPick} />
      {me && <Account me={me} onView={onView} onSignOut={onSignOut} onChangePassword={onChangePassword} />}
    </header>
  );
}
