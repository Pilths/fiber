import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { Dialog } from "@/components/upload-parts";
import { formatDate } from "@/lib/format";
import { ignoreFailure } from "@/lib/utils";

type Me = components["schemas"]["CurrentUser"];
type User = components["schemas"]["UserOut"];
type Temp = components["schemas"]["UserWithPassword"];

const ROLE = { admin: "Admin", planner: "Planner" } as Record<string, string>;
const ERROR_BOX = "rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red";
const lbl = "lbl mb-1 block text-body! text-foreground!";

function TempPassword({ temp, onClose }: { temp: Temp; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(temp.temporary_password).then(() => setCopied(true), ignoreFailure);
  };
  return (
    <div role="region" aria-label="Temporary password" className="mb-4 note px-4 py-3">
      <p className="text-body font-semibold text-amber">Temporary password for {temp.username}</p>
      <div className="mt-2 flex items-center gap-3">
        <code data-testid="temp-password"
          className="rounded border border-amber-bd bg-white px-3 py-1.5 font-mono text-base font-semibold tracking-wide">
          {temp.temporary_password}
        </code>
        <button type="button" className="btn btn-sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn btn-sm ml-auto" onClick={onClose}>Done</button>
      </div>
      <p className="mt-2 text-body text-foreground">
        Shown once. Give it to the user; they must change it at first sign-in.
      </p>
    </div>
  );
}

function AddUser({ onCreated, onCancel }: { onCreated: (temp: Temp) => void; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const body = {
        username: text("username"),
        display_name: text("display_name") || null,
        role: text("role") as "planner" | "admin",
        remarks: text("remarks"),
      };
      onCreated(await api.post("/api/admin/users", { body }));
    } catch (err) {
      setError(errorText(err, "Could not create the user. Try again."));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} aria-label="Add user" className="mb-4 rounded-md border bg-subtle p-4">
      {error && <p role="alert" className={`mb-3 ${ERROR_BOX}`}>{error}</p>}
      <div className="grid grid-cols-[1fr_1fr_160px_1.4fr] gap-3">
        <label>
          <span className={lbl}>Username</span>
          <input name="username" className="field" required autoFocus autoComplete="off" spellCheck={false} />
        </label>
        <label>
          <span className={lbl}>Display name</span>
          <input name="display_name" className="field" autoComplete="off" />
        </label>
        <label><span className={lbl}>Role</span>
          <select name="role" className="field" defaultValue="planner">
            <option value="planner">Planner</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label>
          <span className={lbl}>Remarks (optional)</span>
          <input name="remarks" className="field" autoComplete="off" />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="submit" className="btn btn-p" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ConfirmDeactivate({ user, onDone, onCancel }: { user: User; onDone: () => void; onCancel: () => void }) {
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const deactivate = async () => {
    try {
      await api.post("/api/admin/users/{user_id}/deactivate", { path: { user_id: user.id }, body: { remarks } });
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not deactivate. Try again."));
    }
  };
  return (
    <Dialog title={`Deactivate ${user.username}?`} onClose={onCancel} cls="m-auto w-[440px]">
      <p className="mt-1 text-body text-muted-foreground">They are signed out and cannot sign in until activated.</p>
      {error && <p role="alert" className={`mt-3 ${ERROR_BOX}`}>{error}</p>}
      <label className="mt-4 block"><span className={lbl}>Remarks (optional)</span>
        <input className="field" value={remarks} onChange={(event) => setRemarks(event.target.value)} autoFocus />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-danger" onClick={deactivate}>Deactivate</button>
      </div>
    </Dialog>
  );
}

type UserRowProps = {
  user: User;
  me: Me;
  onAct: (user: User, action: "reset-password" | "activate") => void;
  onDeactivate: (user: User) => void;
};

// Active users other than me can be deactivated; deactivated users can be activated again.
function StatusButton({ user, me, onAct, onDeactivate }: UserRowProps) {
  if (!user.active) {
    return (
      <button type="button" className="btn btn-sm" onClick={() => onAct(user, "activate")}
        aria-label={`Activate ${user.username}`}>Activate</button>
    );
  }
  if (user.id === me.id) {
    return null;
  }
  return (
    <button type="button" className="btn btn-sm" onClick={() => onDeactivate(user)}
      aria-label={`Deactivate ${user.username}`}>Deactivate</button>
  );
}

function UserRow(props: UserRowProps) {
  const { user, me, onAct } = props;
  return (
    <tr data-testid="user-row" data-username={user.username}>
      <th scope="row" className="font-semibold">
        {user.username}
        {user.id === me.id && <span className="ml-2 text-xs font-medium text-muted-foreground">(you)</span>}
      </th>
      <td>{user.display_name}</td>
      <td>{ROLE[user.role] ?? user.role}</td>
      <td>
        <span className="flex flex-wrap gap-1.5">
          {user.active ? <span className="pill h-green">Active</span> : <span className="pill h-ns">Deactivated</span>}
          {user.must_change_password && user.active && <span className="pill h-amber">Must change password</span>}
        </span>
      </td>
      <td className="whitespace-nowrap">{formatDate(user.created_at)}</td>
      <td>
        <span className="flex justify-end gap-2">
          <button type="button" className="btn btn-sm" onClick={() => onAct(user, "reset-password")}
            aria-label={`Reset password for ${user.username}`}>Reset password</button>
          <StatusButton {...props} />
        </span>
      </td>
    </tr>
  );
}

export function Users({ me }: { me: Me }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [temp, setTemp] = useState<Temp | null>(null);
  const [confirm, setConfirm] = useState<User | null>(null);
  const load = useCallback(() => {
    api.get("/api/admin/users")
      .then(setUsers)
      .catch((err) => setError(errorText(err, "Could not load users.")));
  }, []);
  useEffect(() => {
    if (me.role === "admin") {
      load();
    }
  }, [me.role, load]);

  if (me.role !== "admin") {
    return (
      <section className="card mx-auto max-w-3xl" aria-labelledby="users-h">
        <div className="card-h"><h2 id="users-h">Users</h2></div>
        <p role="alert" className="text-body font-semibold">Admins only</p>
        <p className="mt-1 text-body text-muted-foreground">Ask an admin to add, reset or deactivate accounts.</p>
      </section>
    );
  }

  const act = async (user: User, action: "reset-password" | "activate") => {
    setError(null);
    const path = { user_id: user.id };
    try {
      if (action === "reset-password") {
        setTemp(await api.post("/api/admin/users/{user_id}/reset-password", { path }));
      } else {
        await api.post("/api/admin/users/{user_id}/activate", { path });
      }
      load();
    } catch (err) {
      setError(errorText(err, "Action failed. Try again."));
    }
  };
  const startAdding = () => {
    setAdding(true);
    setTemp(null);
  };
  const userCreated = (created: Temp) => {
    setAdding(false);
    setTemp(created);
    load();
  };
  const deactivated = () => {
    setConfirm(null);
    load();
  };

  return (
    <section className="card" aria-labelledby="users-h">
      <div className="card-h items-center">
        <h2 id="users-h">Users</h2>
        {!adding && <button type="button" className="btn btn-p" onClick={startAdding}>Add user</button>}
      </div>
      {error && <p role="alert" className={`mb-4 ${ERROR_BOX}`}>{error}</p>}
      {temp && <TempPassword temp={temp} onClose={() => setTemp(null)} />}
      {adding && <AddUser onCancel={() => setAdding(false)} onCreated={userCreated} />}
      {!users ? <p className="text-body text-muted-foreground">Loading…</p> : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Username</th><th>Display name</th><th>Role</th><th>Status</th><th>Created</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRow key={user.id} user={user} me={me} onAct={act} onDeactivate={setConfirm} />
            ))}
          </tbody>
        </table>
      )}
      {confirm && <ConfirmDeactivate user={confirm} onCancel={() => setConfirm(null)} onDone={deactivated} />}
    </section>
  );
}
