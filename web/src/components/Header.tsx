import { useEffect, useId, useRef, useState } from "react";
import { api, DEV_USERS } from "@/api/client";
import type { components } from "@/api/schema";
import { NavIcon } from "@/components/Icon";

type Result = components["schemas"]["SearchResult"];
type Me = components["schemas"]["CurrentUser"];
const GROUPS: Result["type"][] = ["customer", "span", "circuit", "core"];
const GROUP_LABEL = { customer: "Customers", span: "Spans", circuit: "Circuits", core: "Cores" };

// Global search: GET /api/search already exists, so results come from the server (TASK-079 will add sites and polish).
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
  const label = "Find a span, site, customer, circuit or core";
  return (
    <div ref={box} className="relative ml-auto min-w-[260px] flex-[0_1_420px]">
      <svg viewBox="0 0 16 16" aria-hidden="true" className="ni pointer-events-none absolute left-3 top-2.5 text-muted-foreground"><path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5" /></svg>
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-activedescendant={showList && results[active] ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        placeholder={label}
        className="field pl-9"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {showList && (
        <div id={`${id}-list`} role="listbox" aria-label="Search results" className="absolute inset-x-0 top-[42px] z-30 max-h-[440px] overflow-auto rounded-xl border border-line bg-white py-2">
          {error && <p className="px-4 py-2 text-[13px] text-muted-foreground">Search failed. Try again.</p>}
          {!error && results.length === 0 && <p className="px-4 py-2 text-[13px] text-muted-foreground">No matches.</p>}
          {GROUPS.map((g) => {
            const items = results.map((r, i) => ({ r, i })).filter((x) => x.r.type === g);
            if (!items.length) return null;
            return (
              <div key={g} role="group" aria-label={GROUP_LABEL[g]}>
                <div className="lbl px-4 pt-2">{GROUP_LABEL[g]}</div>
                {items.map(({ r, i }) => (
                  <div
                    key={i}
                    id={`${id}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    aria-disabled={r.span_id == null}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(r)}
                    className={`flex min-h-10 cursor-pointer items-center px-4 py-1.5 aria-disabled:cursor-not-allowed ${i === active ? "bg-blue-bg" : ""}`}
                  >
                    <span className="font-semibold">{r.label}</span>
                    {r.span_id == null && <span className="ml-2 text-[13px] text-muted-foreground">(no span yet)</span>}
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

export type View = "map" | "mine" | "approvals" | "upload" | "users";

const LOGO = (
  <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
    <circle cx="15" cy="15" r="14" fill="#141414" />
    {[[22, 15, 0], [18.5, 21.1, 1], [11.5, 21.1, 0], [8, 15, 0], [11.5, 8.9, 0], [18.5, 8.9, 0]].map(([x, y, f]) => (
      <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill={f ? "#fff" : "none"} stroke="#fff" strokeWidth="1.2" />
    ))}
  </svg>
);

function Account({ me, onView }: { me: Me; onView: (v: View) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("button, select")?.focus();
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const role = me.role === "admin" ? "Admin" : "Planner";
  const initials = (me.display_name.match(/\b\w/g)?.join("") ?? me.username).slice(0, 2).toUpperCase();
  const switchUser = (u: string) => {
    try { localStorage.setItem("devUser", u); } catch { /* storage unavailable */ }
    location.reload();
  };
  const item = "block min-h-9 w-full px-3 text-left font-medium hover:bg-raised focus-visible:-outline-offset-3";
  return (
    <div ref={box} className="relative flex-none" onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); box.current?.querySelector("button")?.focus(); } }}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex h-11 items-center gap-2.5 rounded-md pl-1.5 pr-2.5 text-left hover:bg-raised aria-expanded:bg-raised">
        <span aria-hidden className="grid size-[30px] place-items-center rounded-full bg-[#272a30] text-xs font-semibold text-white">{initials}</span>
        <span>
          <b className="block text-[13px] leading-[17px] font-semibold">{me.display_name}</b>
          <small className="block text-xs leading-4 text-muted-foreground">{role}</small>
        </span>
        <svg viewBox="0 0 16 16" aria-hidden="true" className="ni"><path d="M4 6l4 4 4-4" /></svg>
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Account" className="absolute right-0 top-[50px] z-30 min-w-[220px] rounded-xl border border-line bg-white py-1.5">
          <p className="mb-1.5 border-b px-3 pb-2.5 pt-2 text-[13px] whitespace-nowrap text-muted-foreground"><b className="font-semibold text-foreground">{me.display_name}</b> · {role}</p>
          {me.role === "admin" && <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onView("users"); }}>Users</button>}
          {/* Sign out is a stub until real sign-in lands (TASK-034). */}
          <button type="button" role="menuitem" className={item} onClick={() => setOpen(false)}>Sign out</button>
          {import.meta.env.DEV && (
            <label className="mt-1.5 block border-t px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">Dev user (development only)
              <select aria-label="Dev user" className="field mt-1 h-8 text-sm text-foreground" value={me.username} onChange={(e) => switchUser(e.target.value)}>
                {DEV_USERS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

export function Header({ onPick, view, onView, me, approvals, stale }: {
  onPick: (r: Result) => void;
  view: View;
  onView: (v: View) => void;
  me: Me | null;
  approvals: number | null;
  stale: number;
}) {
  const admin = me?.role === "admin";
  const tabs: [View, string, string, React.ReactNode][] = [
    ["map", "Map", "M2 4l4-1.5 4 1.5 4-1.5v9.5l-4 1.5-4-1.5-4 1.5zM6 2.5v9.5M10 4v9.5", null],
    ["mine", "My reservations", "M4 2.5h8v11l-4-3-4 3z", stale > 0 && <span key="b" className="badge">{stale}<span className="sr-only"> stale</span></span>],
  ];
  if (admin) {
    tabs.push(["approvals", "Approvals", "M3 8.5l3 3 7-7", approvals ? <span key="b" className="badge">{approvals} waiting</span> : null]);
    tabs.push(["upload", "Upload", "M8 11V3M5 6l3-3 3 3M3 13h10", null]);
  }
  return (
    <header className="sticky top-0 z-20 flex h-[60px] items-center gap-5 border-b bg-white px-6">
      <div className="flex flex-none items-center gap-2.5">
        {LOGO}
        <div>
          <h1 className="text-base leading-5 font-semibold">Fiber</h1>
          <span className="block text-xs leading-4 whitespace-nowrap text-muted-foreground">Malaysia network</span>
        </div>
      </div>
      <nav aria-label="Main">
        <ul className="flex items-center gap-0.5">
          {tabs.map(([v, label, d, extra]) => (
            <li key={v}>
              <button type="button" aria-current={view === v ? "page" : undefined} onClick={() => onView(v)}
                className="flex h-9 items-center gap-2 rounded-md px-2.5 whitespace-nowrap text-[#3d4046] hover:bg-raised aria-[current=page]:bg-[#e4e7ec] aria-[current=page]:font-semibold aria-[current=page]:text-foreground">
                <NavIcon d={d} /><span>{label}</span>{extra}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <GlobalSearch onPick={onPick} />
      {me && <Account me={me} onView={onView} />}
    </header>
  );
}
