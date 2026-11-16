import { useEffect, useRef, useState } from "react";
import { DEV_USERS, setDevUser } from "@/api/client";
import type { components } from "@/api/schema";
import type { View } from "@/components/Header";
import { useCloseOnOutsideClick } from "@/lib/useCloseOnOutsideClick";

type Me = components["schemas"]["CurrentUser"];

const MENU_CLASS =
  "absolute right-0 top-[50px] z-30 min-w-[220px] rounded-xl border border-line bg-white py-1.5";
const MENU_ITEM_CLASS =
  "block min-h-9 w-full px-3 text-left font-medium hover:bg-raised focus-visible:-outline-offset-3";
const ACCOUNT_BUTTON_CLASS =
  "flex h-11 items-center gap-2.5 rounded-md pl-1.5 pr-2.5 text-left hover:bg-raised aria-expanded:bg-raised";
const INITIALS_CLASS =
  "grid size-[30px] place-items-center rounded-full bg-res text-xs font-semibold text-white";

export type AccountActions = { onSignOut: () => void; onChangePassword: () => void };

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

export function Account({ me, onView, onSignOut, onChangePassword }: AccountProps) {
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
