import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { Dialog } from "@/components/upload-parts";
import { when } from "@/lib/status";

type Row = components["schemas"]["HistoryRow"];
type SpanEdit = components["schemas"]["SpanEdit"];
type SiteEdit = components["schemas"]["SiteEdit"];
type Site = { id: number; name: string };

const REGIONS = ["Central", "East Coast", "North", "South"];
const FIELD: Record<string, string> = {
  distance_km: "Distance (km)", route_type: "Route type", region: "Region", site_a_id: "Site A (id)", site_b_id: "Site B (id)",
  survey_cores: "Survey count", cable_size: "Cable size", name: "Name", location: "Location", active: "Active", status: "Status",
};
const lbl = "lbl mb-1 block text-[13px]! text-foreground!";

// Latest edits of one item, newest first: who, when, field old -> new, reason.
export function EditHistory({ rows }: { rows: Row[] }) {
  return (
    <details className="mt-4 border-t pt-3 text-[13px]" data-testid="edit-history">
      <summary className="w-fit cursor-pointer font-semibold">History ({rows.length === 10 ? "last 10" : rows.length})</summary>
      {rows.length === 0 ? <p className="mt-2 text-muted-foreground">No edits yet.</p> : (
        <ol className="mt-2 max-h-56 overflow-y-auto">
          {rows.map((r, i) => (
            <li key={i} className="border-b border-rule py-1.5 last:border-b-0">
              <span className="font-semibold">{FIELD[r.field] ?? r.field}</span>: {r.old_value ?? "blank"} <span aria-label="became">→</span> {r.new_value ?? "blank"}
              <span className="block text-muted-foreground">{r.user}, {when(String(r.at))}</span>
              <span className="block">Reason: {r.reason}</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

// Plain words for the admin edit errors; 409 survey-lower carries the blocking core numbers.
function editError(e: unknown) {
  const d = e instanceof ApiError ? (e.detail as { detail?: { blocking_core_numbers?: number[] } } | null)?.detail : null;
  const ns = d && typeof d === "object" ? d.blocking_core_numbers : undefined;
  if (ns?.length) return `Cores ${ns.join(", ")} are in use or have history and cannot be removed. The survey count stays as it is.`;
  if (e instanceof ApiError && e.status === 400) return "Nothing changed.";
  return errorText(e, "Could not save. Try again.");
}

function Reason({ value, onChange, missing }: { value: string; onChange: (v: string) => void; missing: boolean }) {
  return (
    <label className="col-span-2 block"><span className={lbl}>Reason (required)</span>
      <input className="field" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={missing} />
      {missing && <span role="alert" className="mt-1 block text-[13px] font-semibold text-red">Enter a reason: every edit is kept as history.</span>}
    </label>
  );
}

// Site typeahead on the native <datalist>; a name must match one from the list to count.
function SitePicker({ label, site, onPick }: { label: string; site: Site | null; onPick: (s: Site | null) => void }) {
  const id = useId();
  const [text, setText] = useState(site?.name ?? "");
  const [opts, setOpts] = useState<Site[]>([]);
  useEffect(() => {
    const q = text.trim();
    if (!q) return;
    const t = setTimeout(() => api.get("/api/admin/sites", { query: { q } }).then((r) => setOpts(r as unknown as Site[])).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [text]);
  const change = (v: string) => {
    setText(v);
    onPick(opts.find((o) => o.name === v) ?? (v === site?.name ? site : null));
  };
  return (
    <label className="block"><span className={lbl}>{label}</span>
      <input className="field" list={id} value={text} onChange={(e) => change(e.target.value)} autoComplete="off" aria-invalid={!site} />
      <datalist id={id}>{opts.map((o) => <option key={o.id} value={o.name} />)}</datalist>
      {!site && <span className="mt-1 block text-[13px] font-semibold text-red">Choose a site from the list.</span>}
    </label>
  );
}

function Buttons({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" className="btn btn-p" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    </div>
  );
}

export function EditSpanDialog({ spanId, focus, onClose, onSaved }: { spanId: number; focus?: "survey"; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<SpanEdit | null>(null);
  const [f, setF] = useState({ distance: "", route: "", region: "", survey: "", cable: "", reason: "" });
  const [a, setA] = useState<Site | null>(null);
  const [b, setB] = useState<Site | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const survey = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let stale = false; // a late second load (StrictMode runs effects twice) must not overwrite what the user typed
    api.get("/api/admin/spans/{sid}", { path: { sid: spanId } }).then((x) => {
      if (stale) return;
      setS(x);
      setF({ distance: x.distance_km == null ? "" : String(Number(x.distance_km)), route: x.route_type ?? "", region: x.region ?? "",
        survey: x.survey_cores == null ? "" : String(x.survey_cores), cable: String(x.cable_size), reason: "" });
      setA({ id: x.site_a_id, name: x.site_a });
      setB({ id: x.site_b_id, name: x.site_b });
    }).catch((e) => !stale && setError(errorText(e, "Could not load the span.")));
    return () => { stale = true; };
  }, [spanId]);
  useEffect(() => { if (s && focus === "survey") survey.current?.focus(); }, [s, focus]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((o) => ({ ...o, [k]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!s || !f.reason.trim() || !a || !b) return;
    // Only changed fields are sent.
    const body: components["schemas"]["SpanBody"] = { reason: f.reason.trim() };
    if (f.distance !== "" && (s.distance_km == null || Number(f.distance) !== Number(s.distance_km))) body.distance_km = f.distance;
    if (f.route && f.route !== s.route_type) body.route_type = f.route as "Bespoke" | "Trunk" | "Metro";
    if (f.region && f.region !== s.region) body.region = f.region;
    if (a.id !== s.site_a_id) body.site_a_id = a.id;
    if (b.id !== s.site_b_id) body.site_b_id = b.id;
    if (f.survey !== "" && Number(f.survey) !== s.survey_cores) body.survey_cores = Number(f.survey);
    if (f.cable !== "" && Number(f.cable) !== s.cable_size) body.cable_size = Number(f.cable);
    if (Object.keys(body).length === 1) { setError("Nothing changed."); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/spans/{sid}", { path: { sid: spanId }, body });
      onSaved();
      onClose();
    } catch (err) {
      setError(editError(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title={s ? `Edit span ${s.site_a} - ${s.site_b}` : "Edit span"} onClose={onClose} wide>
      {error && <p role="alert" className="mt-3 rounded-md border border-red bg-red-bg px-3 py-2 text-[13px] font-semibold text-red">{error}</p>}
      {!s ? !error && <p className="mt-3 text-[13px] text-muted-foreground">Loading…</p> : (
        <form onSubmit={submit} noValidate aria-label="Edit span">
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label><span className={lbl}>Distance (km)</span><input className="field" type="number" min="0" step="0.001" value={f.distance} onChange={set("distance")} /></label>
            <label><span className={lbl}>Route type</span>
              <select className="field" value={f.route} onChange={set("route")}>
                {!s.route_type && <option value="">Not set</option>}
                {["Bespoke", "Trunk", "Metro"].map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label><span className={lbl}>Region</span>
              <select className="field" value={f.region} onChange={set("region")}>
                {!s.region && <option value="">Not set</option>}
                {REGIONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <span />
            <SitePicker label="Site A" site={a} onPick={setA} />
            <SitePicker label="Site B" site={b} onPick={setB} />
            <label><span className={lbl}>Survey count</span>
              <input ref={survey} className="field" type="number" min="0" step="1" value={f.survey} onChange={set("survey")} placeholder="Not surveyed" />
            </label>
            <label><span className={lbl}>Cable size</span><input className="field" type="number" min="1" step="1" value={f.cable} onChange={set("cable")} /></label>
            <p className="col-span-2 -mt-1 text-[13px] text-muted-foreground">
              Survey count sets how many cores can be booked. Cable size is information only. Lowering the survey count is refused while a removed core is held, in use, faulty or has history. Changing sites is refused while the span has active reservations.
            </p>
            <Reason value={f.reason} onChange={(v) => setF((o) => ({ ...o, reason: v }))} missing={tried && !f.reason.trim()} />
          </div>
          <Buttons busy={busy} onClose={onClose} />
          <EditHistory rows={s.history} />
        </form>
      )}
    </Dialog>
  );
}

export function EditSiteDialog({ siteId, onClose, onSaved }: { siteId: number; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<SiteEdit | null>(null);
  const [f, setF] = useState({ name: "", lat: "", lon: "", region: "", active: true, reason: "" });
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stale = false;
    api.get("/api/admin/sites/{sid}", { path: { sid: siteId } }).then((x) => {
      if (stale) return;
      setS(x);
      setF({ name: x.name, lat: x.lat == null ? "" : String(x.lat), lon: x.lon == null ? "" : String(x.lon), region: x.region ?? "", active: x.active, reason: "" });
    }).catch((e) => !stale && setError(errorText(e, "Could not load the site.")));
    return () => { stale = true; };
  }, [siteId]);

  const set = (k: "name" | "lat" | "lon" | "region") => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((o) => ({ ...o, [k]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!s || !f.reason.trim()) return;
    const body: components["schemas"]["SiteBody"] = { reason: f.reason.trim() };
    if (f.name.trim() !== s.name) body.name = f.name;
    if (f.lat !== "" && Number(f.lat) !== s.lat) body.lat = Number(f.lat);
    if (f.lon !== "" && Number(f.lon) !== s.lon) body.lon = Number(f.lon);
    if (f.region && f.region !== s.region) body.region = f.region;
    if (f.active !== s.active) body.active = f.active;
    if (Object.keys(body).length === 1) { setError("Nothing changed."); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/sites/{sid}", { path: { sid: siteId }, body });
      onSaved();
      onClose();
    } catch (err) {
      setError(editError(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title={s ? `Edit site ${s.name}` : "Edit site"} onClose={onClose} wide>
      {error && <p role="alert" className="mt-3 rounded-md border border-red bg-red-bg px-3 py-2 text-[13px] font-semibold text-red">{error}</p>}
      {!s ? !error && <p className="mt-3 text-[13px] text-muted-foreground">Loading…</p> : (
        <form onSubmit={submit} noValidate aria-label="Edit site">
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="col-span-2"><span className={lbl}>Name</span><input className="field" value={f.name} onChange={set("name")} /></label>
            <label><span className={lbl}>Latitude</span><input className="field" type="number" step="any" min="-90" max="90" value={f.lat} onChange={set("lat")} placeholder="No location" /></label>
            <label><span className={lbl}>Longitude</span><input className="field" type="number" step="any" min="-180" max="180" value={f.lon} onChange={set("lon")} placeholder="No location" /></label>
            <label><span className={lbl}>Region</span>
              <select className="field" value={f.region} onChange={set("region")}>
                {!s.region && <option value="">Not set</option>}
                {REGIONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="size-4" checked={f.active} onChange={(e) => setF((o) => ({ ...o, active: e.target.checked }))} />Active
            </label>
            <p className="col-span-2 -mt-1 text-[13px] text-muted-foreground">
              {f.active ? "Kind: " + s.kind.replace("_", " ") + "." : <b className="font-semibold text-amber">Inactive sites are kept, never deleted. A site used by a span cannot be deactivated.</b>}
            </p>
            <Reason value={f.reason} onChange={(v) => setF((o) => ({ ...o, reason: v }))} missing={tried && !f.reason.trim()} />
          </div>
          <Buttons busy={busy} onClose={onClose} />
          <EditHistory rows={s.history} />
        </form>
      )}
    </Dialog>
  );
}
