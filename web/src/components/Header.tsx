import type { components } from "@/api/schema";
import { Account, type AccountActions } from "@/components/AccountMenu";
import { GlobalSearch, type SearchResult } from "@/components/GlobalSearch";
import { NavIcon } from "@/components/Icon";

type Me = components["schemas"]["CurrentUser"];

const TAB_CLASS =
  "flex h-9 items-center gap-2 rounded-md px-2.5 whitespace-nowrap text-nav-ink hover:bg-raised " +
  "aria-[current=page]:bg-foreground aria-[current=page]:font-semibold aria-[current=page]:text-white";

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
  onPick: (result: SearchResult) => void;
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
