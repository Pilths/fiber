import { useState } from "react";
import { api, errorText } from "@/api/client";
import { SITE_KINDS } from "@/lib/useSiteList";
import { Dialog } from "@/components/upload-parts";

const LBL = "lbl mb-1 block text-body! text-foreground!";

export function AddSiteBox({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", kind: "site", lat: "", lon: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((old) => ({ ...old, [key]: event.target.value }));
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/sites", {
        body: {
          name: form.name,
          kind: form.kind,
          lat: form.lat === "" ? null : Number(form.lat),
          lon: form.lon === "" ? null : Number(form.lon),
          remarks: "",
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not add the site."));
      setBusy(false);
    }
  };
  return (
    <Dialog title="Add site" onClose={onClose} wide>
      <form onSubmit={submit} noValidate aria-label="Add site">
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="col-span-2">
            <span className={LBL}>Name</span>
            <input className="field" value={form.name} onChange={set("name")} aria-invalid={error != null} autoFocus />
          </label>
          <label>
            <span className={LBL}>Type</span>
            <select className="field" value={form.kind} onChange={set("kind")}>
              {SITE_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <span />
          <label>
            <span className={LBL}>Lat</span>
            <input className="field" inputMode="decimal" value={form.lat} onChange={set("lat")} />
          </label>
          <label>
            <span className={LBL}>Long</span>
            <input className="field" inputMode="decimal" value={form.lon} onChange={set("lon")} />
          </label>
        </div>
        {error && <p role="alert" className="mt-3 text-body font-semibold text-red">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-p" disabled={busy}>Add site</button>
        </div>
      </form>
    </Dialog>
  );
}
