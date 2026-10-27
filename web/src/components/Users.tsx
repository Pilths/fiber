import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";

type Me = components["schemas"]["CurrentUser"];
type User = components["schemas"]["UserOut"];
type Temp = components["schemas"]["UserWithPassword"];

const created = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const ROLE = { admin: "Admin", planner: "Planner" } as Record<string, string>;

function TempPassword({ t, onClose }: { t: Temp; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="region" aria-label="Temporary password" className="mb-4 note px-4 py-3">
      <p className="text-body font-semibold text-amber">Temporary password for {t.username}</p>
      <div className="mt-2 flex items-center gap-3">
        <code data-testid="temp-password" className="rounded border border-amber-bd bg-white px-3 py-1.5 font-mono text-base font-semibold tracking-wide">{t.temporary_password}</code>
        <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(t.temporary_password).then(() => setCopied(true), () => {})}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn btn-sm ml-auto" onClick={onClose}>Done</button>
      </div>
      <p className="mt-2 text-body text-foreground">Shown once. Give it to the user; they must change it at first sign-in.</p>
    </div>
  );
}

function AddUser({ onCreated, onCancel }: { onCreated: (t: Temp) => void; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.post("/api/admin/users", {
        body: { username: s("username"), display_name: s("display_name") || null, role: s("role") as "planner" | "admin", reason: s("reason") },
      }));
    } catch (err) {
      setError(errorText(err, "Could not create the user. Try again."));
      setBusy(false);
    }
  };
  const lbl = "lbl mb-1 block text-body! text-foreground!";
  return (
    <form onSubmit={submit} aria-label="Add user" className="mb-4 rounded-md border bg-subtle p-4">
      {error && <p role="alert" className="mb-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">{error}</p>}
      <div className="grid grid-cols-[1fr_1fr_160px_1.4fr] gap-3">
        <label><span className={lbl}>Username</span><input name="username" className="field" required autoFocus autoComplete="off" spellCheck={false} /></label>
        <label><span className={lbl}>Display name</span><input name="display_name" className="field" autoComplete="off" /></label>
        <label><span className={lbl}>Role</span>
          <select name="role" className="field" defaultValue="planner"><option value="planner">Planner</option><option value="admin">Admin</option></select>
        </label>
        <label><span className={lbl}>Reason (optional)</span><input name="reason" className="field" autoComplete="off" /></label>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="submit" className="btn btn-p" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ConfirmDeactivate({ user, onDone, onCancel }: { user: User; onDone: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const go = async () => {
    try {
      await api.post("/api/admin/users/{user_id}/deactivate", { path: { user_id: user.id }, body: { reason } });
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not deactivate. Try again."));
    }
  };
  return (
    <dialog ref={ref} aria-labelledby="deact-h" onClose={onCancel} className="m-auto w-[440px] rounded-lg border bg-white p-6 backdrop:bg-black/30">
      <h2 id="deact-h" className="text-base font-semibold">Deactivate {user.username}?</h2>
      <p className="mt-1 text-body text-muted-foreground">They are signed out and cannot sign in until activated.</p>
      {error && <p role="alert" className="mt-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">{error}</p>}
      <label className="mt-4 block"><span className="lbl mb-1 block text-body! text-foreground!">Reason (optional)</span>
        <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
        <button type="button" className="btn btn-danger" onClick={go}>Deactivate</button>
      </div>
    </dialog>
  );
}

export function Users({ me }: { me: Me }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [temp, setTemp] = useState<Temp | null>(null);
  const [confirm, setConfirm] = useState<User | null>(null);
  const load = useCallback(() => {
    api.get("/api/admin/users").then(setUsers).catch((e) => setError(errorText(e, "Could not load users.")));
  }, []);
  useEffect(() => { if (me.role === "admin") load(); }, [me.role, load]);

  if (me.role !== "admin") {
    return (
      <section className="card mx-auto max-w-3xl" aria-labelledby="users-h">
        <div className="card-h"><h2 id="users-h">Users</h2></div>
        <p role="alert" className="text-body font-semibold">Admins only</p>
        <p className="mt-1 text-body text-muted-foreground">Ask an admin to add, reset or deactivate accounts.</p>
      </section>
    );
  }

  const act = async (u: User, action: "reset-password" | "activate") => {
    setError(null);
    try {
      if (action === "reset-password") setTemp(await api.post("/api/admin/users/{user_id}/reset-password", { path: { user_id: u.id } }));
      else await api.post("/api/admin/users/{user_id}/activate", { path: { user_id: u.id } });
      load();
    } catch (e) {
      setError(errorText(e, "Action failed. Try again."));
    }
  };

  return (
    <section className="card" aria-labelledby="users-h">
      <div className="card-h items-center">
        <div className="flex items-baseline gap-3">
          <h2 id="users-h">Users</h2>
          <small className="hint">Nothing is deleted: deactivate an account to stop it signing in.</small>
        </div>
        {!adding && <button type="button" className="btn btn-p" onClick={() => { setAdding(true); setTemp(null); }}>Add user</button>}
      </div>
      {error && <p role="alert" className="mb-4 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">{error}</p>}
      {temp && <TempPassword t={temp} onClose={() => setTemp(null)} />}
      {adding && <AddUser onCancel={() => setAdding(false)} onCreated={(t) => { setAdding(false); setTemp(t); load(); }} />}
      {!users ? <p className="text-body text-muted-foreground">Loading…</p> : (
        <table className="tbl">
          <thead><tr><th>Username</th><th>Display name</th><th>Role</th><th>Status</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} data-testid="user-row" data-username={u.username}>
                <th scope="row" className="text-left font-semibold">{u.username}{u.id === me.id && <span className="ml-2 text-xs font-medium text-muted-foreground">(you)</span>}</th>
                <td>{u.display_name}</td>
                <td>{ROLE[u.role] ?? u.role}</td>
                <td>
                  <span className="flex flex-wrap gap-1.5">
                    {u.active ? <span className="pill h-green">Active</span> : <span className="pill h-ns">Deactivated</span>}
                    {u.must_change_password && u.active && <span className="pill h-amber">Must change password</span>}
                  </span>
                </td>
                <td className="whitespace-nowrap">{created(u.created_at)}</td>
                <td className="pr-0!">
                  <span className="flex justify-end gap-2">
                    <button type="button" className="btn btn-sm" onClick={() => act(u, "reset-password")} aria-label={`Reset password for ${u.username}`}>Reset password</button>
                    {u.active
                      ? u.id !== me.id && <button type="button" className="btn btn-sm" onClick={() => setConfirm(u)} aria-label={`Deactivate ${u.username}`}>Deactivate</button>
                      : <button type="button" className="btn btn-sm" onClick={() => act(u, "activate")} aria-label={`Activate ${u.username}`}>Activate</button>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {confirm && <ConfirmDeactivate user={confirm} onCancel={() => setConfirm(null)} onDone={() => { setConfirm(null); load(); }} />}
    </section>
  );
}
