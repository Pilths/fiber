import { useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { LOGO } from "@/components/Header";

type Me = components["schemas"]["CurrentUser"];
const MIN = 10; // same as the API (app/auth/router.py MIN_PASSWORD)

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="card w-[400px] p-8!" aria-labelledby="auth-h">
        <div className="mb-6 flex items-center gap-2.5">
          {LOGO}
          <p className="text-base leading-5 font-semibold">Fiber</p>
        </div>
        <h1 id="auth-h" className="mb-5 text-xl leading-7 font-semibold">{title}</h1>
        {children}
      </section>
    </main>
  );
}

const Field = ({ label, ...p }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className="mb-4 block">
    <span className="lbl mb-1 block text-body! text-foreground!">{label}</span>
    <input className="field" required {...p} />
  </label>
);

const Alert = ({ text }: { text: string | null }) =>
  text ? <p role="alert" className="mb-4 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">{text}</p> : null;

export function Login({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.post("/api/auth/login", { body: { username: String(f.get("username")), password: String(f.get("password")) } }));
    } catch (err) {
      setError(errorText(err, "Could not sign in. Try again.")); // the API says only "Wrong username or password"
      setBusy(false);
    }
  };
  return (
    <Shell title="Sign in">
      <form onSubmit={submit}>
        <Alert text={error} />
        <Field label="Username" name="username" autoComplete="username" autoFocus autoCapitalize="none" spellCheck={false} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        <button type="submit" className="btn btn-p mt-2 w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </Shell>
  );
}

export function ChangePassword({ me, forced, onDone, onSignOut, onCancel }: {
  me: Me; forced: boolean; onDone: () => void; onSignOut: () => void; onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const [cur, next, again] = ["current", "new", "confirm"].map((k) => String(f.get(k)));
    const bad = next.length < MIN ? `New password must be at least ${MIN} characters`
      : next !== again ? "The new passwords do not match"
      : next === cur ? "New password must differ from the current one" : null;
    setError(bad);
    if (bad) return;
    setBusy(true);
    try {
      await api.post("/api/auth/change-password", { body: { current_password: cur, new_password: next } });
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not change the password. Try again."));
      setBusy(false);
    }
  };
  const link = "font-semibold text-blue underline-offset-2 hover:underline";
  return (
    <Shell title="Change password">
      {forced && <p className="mb-4 text-body text-muted-foreground">Signed in as <b className="font-semibold text-foreground">{me.username}</b>. Choose a new password before you continue.</p>}
      <form onSubmit={submit}>
        <Alert text={error} />
        <input type="text" name="username" autoComplete="username" value={me.username} readOnly hidden />
        <Field label="Current password" name="current" type="password" autoComplete="current-password" autoFocus />
        <Field label="New password" name="new" type="password" autoComplete="new-password" aria-describedby="pw-hint" />
        <p id="pw-hint" className="-mt-3 mb-4 text-xs text-muted-foreground">At least {MIN} characters, different from the current one.</p>
        <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" />
        <button type="submit" className="btn btn-p mt-2 w-full" disabled={busy}>{busy ? "Changing…" : "Change password"}</button>
      </form>
      <p className="mt-5 text-center text-body">
        {forced
          ? <button type="button" className={link} onClick={onSignOut}>Sign out</button>
          : <button type="button" className={link} onClick={onCancel}>Back to the dashboard</button>}
      </p>
    </Shell>
  );
}
