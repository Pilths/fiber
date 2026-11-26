import { useState } from "react";
import { api, errorText } from "@/api/client";
import { Dialog } from "@/components/upload-parts";
import type { SiteRow } from "@/lib/useSiteList";

const LBL = "lbl mb-1 block text-body! text-foreground!";

function SiteSelect({ label, value, sites, onChange }: {
  label: string; value: string; sites: SiteRow[]; onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className={LBL}>{label}</span>
      <select className="field" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">-</option>
        {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
      </select>
    </label>
  );
}

export function AddSegmentBox({ sites, siteAId, onClose, onSaved }: {
  sites: SiteRow[]; siteAId: number | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ a: siteAId == null ? "" : String(siteAId), b: "", distance: "", route: "", section: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((old) => ({ ...old, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.a || !form.b || form.distance === "") {
      setError("Choose both sites and enter the distance.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/segments", {
        body: {
          site_a_id: Number(form.a),
          site_b_id: Number(form.b),
          distance_km: form.distance,
          route: form.route.trim() || null,
          section: form.section.trim() || null,
          remarks: "",
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not add the segment."));
      setBusy(false);
    }
  };
  return (
    <Dialog title="Add segment" onClose={onClose} wide>
      <form onSubmit={submit} noValidate aria-label="Add segment">
        <div className="mt-4 grid grid-cols-2 gap-3">
          <SiteSelect label="Site A" value={form.a} sites={sites} onChange={set("a")} />
          <SiteSelect label="Site B" value={form.b} sites={sites} onChange={set("b")} />
          <label>
            <span className={LBL}>Distance (km)</span>
            <input className="field" inputMode="decimal" value={form.distance}
              onChange={(event) => set("distance")(event.target.value)} />
          </label>
          <label>
            <span className={LBL}>Route</span>
            <input className="field" placeholder="R1" value={form.route}
              onChange={(event) => set("route")(event.target.value)} />
          </label>
          <label>
            <span className={LBL}>Cluster</span>
            <input className="field" value={form.section} onChange={(event) => set("section")(event.target.value)} />
          </label>
        </div>
        {error && <p role="alert" className="mt-3 text-body font-semibold text-red">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-p" disabled={busy}>Add segment</button>
        </div>
      </form>
    </Dialog>
  );
}
