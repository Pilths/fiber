import { useEffect, useId, useRef, useState } from "react";
import { Bell as BellIcon, Moon, Search, Sun } from "lucide-react";
import { api, DEV_USERS } from "@/api/client";
import type { components } from "@/api/schema";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/lib/status";

type Result = components["schemas"]["SearchResult"];
type Theme = "system" | "light" | "dark";
const GROUPS: Result["type"][] = ["customer", "span", "circuit", "core"];
const GROUP_LABEL = { customer: "Customers", span: "Spans", circuit: "Circuits", core: "Cores" };

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem("theme");
      return t === "light" || t === "dark" ? t : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    try {
      if (theme === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", theme);
    } catch {
      /* storage unavailable: theme just won't persist */
    }
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"))] as const;
}

function GlobalSearch({ onPick }: { onPick: (r: Result) => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      api
        .get("/api/search", { query: { q: term } })
        .then((r) => {
          if (stale) return;
          setError(false);
          setResults(GROUPS.flatMap((g) => r.filter((x) => x.type === g)));
          setActive(0);
        })
        .catch(() => !stale && setError(true));
    }, 200);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (r: Result) => {
    if (r.span_id == null) return; // nothing to open (e.g. customer without reservations)
    setOpen(false);
    setQ("");
    onPick(r);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (results.length) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
    } else if (e.key === "Enter" && open && results[active]) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape") setOpen(false);
  };

  const showList = open && q.trim() !== "";
  return (
    <div ref={box} className="relative w-full max-w-md">
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
      <input
        role="combobox"
        aria-label="Search customer, circuit, core or span"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-activedescendant={showList && results[active] ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        placeholder="Search customer, circuit, core or span"
        className={`${inputCls} w-full pl-8`}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {showList && (
        <div id={`${id}-list`} role="listbox" aria-label="Search results" className="absolute z-30 mt-1 max-h-96 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          {error && <p className="p-2 text-sm">Search failed. Try again.</p>}
          {!error && results.length === 0 && <p className="p-2 text-sm">No matches.</p>}
          {GROUPS.map((g) => {
            const items = results.map((r, i) => ({ r, i })).filter((x) => x.r.type === g);
            if (!items.length) return null;
            return (
              <div key={g} role="group" aria-label={GROUP_LABEL[g]}>
                <div className="px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{GROUP_LABEL[g]}</div>
                {items.map(({ r, i }) => (
                  <div
                    key={i}
                    id={`${id}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    aria-disabled={r.span_id == null}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(r)}
                    className={`cursor-pointer rounded-md px-2 py-1.5 text-sm aria-disabled:cursor-not-allowed ${i === active ? "bg-accent text-accent-foreground" : ""}`}
                  >
                    {r.label}
                    {r.span_id == null && <span className="text-muted-foreground"> (no span yet)</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export type View = "spans" | "mine" | "approvals" | "review";
type Me = components["schemas"]["CurrentUser"];
type Bell = components["schemas"]["Bell"];

export function Header({ onPick, view, onView, me, bell }: {
  onPick: (r: Result) => void;
  view: View;
  onView: (v: View) => void;
  me: Me | null;
  bell: Bell | null;
}) {
  const [theme, cycle] = useTheme();
  const Icon = theme === "dark" ? Moon : Sun;
  const nav: [View, string][] = [["spans", "Spans"], ["mine", "My reservations"], ...(me?.role === "admin" ? [["approvals", "Approvals"] as [View, string]] : []), ["review", "Needs review"]];
  const total = bell?.total ?? 0;
  const switchUser = (u: string) => {
    try { localStorage.setItem("devUser", u); } catch { /* storage unavailable */ }
    location.reload();
  };
  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b bg-background px-4 py-2">
      <h1 className="text-base font-semibold">Fiber Dashboard</h1>
      <nav aria-label="Main" className="flex flex-wrap gap-1">
        {nav.map(([v, label]) => (
          <Button key={v} variant={view === v ? "secondary" : "ghost"} size="sm" aria-current={view === v ? "page" : undefined} onClick={() => onView(v)}>
            {label}
            {v === "approvals" && bell ? ` (${bell.approvals})` : ""}
            {v === "review" && bell ? ` (${bell.needs_review})` : ""}
          </Button>
        ))}
      </nav>
      <div className="order-last w-full md:order-none md:flex-1 md:w-auto md:flex md:justify-center">
        <GlobalSearch onPick={onPick} />
      </div>
      <Button variant="outline" size="sm" aria-label={`Notifications: ${total} waiting`} onClick={() => onView(me?.role === "admin" && bell?.approvals ? "approvals" : "review")}>
        <BellIcon aria-hidden /> <span>{total}</span>
      </Button>
      {import.meta.env.DEV && me && (
        <label className="text-sm">Dev user{" "}
          <select className={inputCls} value={me.username} onChange={(e) => switchUser(e.target.value)}>
            {DEV_USERS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
      )}
      <Button variant="outline" size="sm" onClick={cycle} aria-label={`Theme: ${theme}. Click to change`}>
        <Icon aria-hidden /> Theme: {theme}
      </Button>
    </header>
  );
}
