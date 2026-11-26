import { useEffect, useId, useState } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { MapElements } from "@/components/MapElements";
import { PastePortsDialog } from "@/components/PastePortsDialog";
import { Dialog } from "@/components/upload-parts";
import { formatDateTime } from "@/lib/format";
import { SITE_KINDS } from "@/lib/useSiteList";
import { type SegmentFocus, type Site, useEditSegment, useEditSite } from "@/lib/useAdminEdit";
import { ignoreFailure } from "@/lib/utils";

export type { SegmentFocus };

type Row = components["schemas"]["HistoryRow"];

const REGIONS = ["Central", "East Coast", "North", "South"];
const FIELD: Record<string, string> = {
  distance_km: "Distance (km)", route_type: "Route type", region: "Region", site_a_id: "Site A (id)",
  site_b_id: "Site B (id)", survey_cores: "Registered cores", cable_size: "Total cores", fiber_cut: "Fiber cut",
  route: "Route", section: "Cluster", kind: "Type", name: "Name", location: "Location", active: "Active", status: "Status",
};
const lbl = "lbl mb-1 block text-body! text-foreground!";

// Latest edits of one item, newest first: who, when, field old -> new, remarks.
export function EditHistory({ rows }: { rows: Row[] }) {
  return (
    <details className="mt-4 border-t pt-3 text-body" data-testid="edit-history">
      <summary className="w-fit cursor-pointer font-semibold">
        History ({rows.length === 10 ? "last 10" : rows.length})
      </summary>
      {rows.length === 0 ? <p className="mt-2 text-muted-foreground">No edits yet.</p> : (
        <ol className="mt-2 max-h-56 overflow-y-auto">
          {rows.map((row, i) => (
            <li key={i} className="border-b border-rule py-1.5 last:border-b-0">
              <span className="font-semibold">{FIELD[row.field] ?? row.field}</span>: {row.old_value ?? "blank"}{" "}
              <span aria-label="became">→</span> {row.new_value ?? "blank"}
              <span className="block text-muted-foreground">{row.user}, {formatDateTime(String(row.at))}</span>
              {row.remarks && <span className="block">Remarks: {row.remarks}</span>}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

function Remarks({ value, onChange, autoFocus }: {
  value: string; onChange: (value: string) => void; autoFocus?: boolean;
}) {
  return (
    <label className="col-span-2 block"><span className={lbl}>Remarks (optional)</span>
      <input className="field" autoFocus={autoFocus} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

// Site typeahead on the native <datalist>; a name must match one from the list to count.
export function SitePicker({ label, site, onPick }: {
  label: string; site: Site | null; onPick: (site: Site | null) => void;
}) {
  const id = useId();
  const [text, setText] = useState(site?.name ?? "");
  const [options, setOptions] = useState<Site[]>([]);
  useEffect(() => {
    const query = text.trim();
    if (!query) {
      return;
    }
    const search = () => {
      api.get("/api/admin/sites", { query: { q: query } })
        .then((found) => setOptions(found as unknown as Site[]))
        .catch(ignoreFailure);
    };
    const timer = setTimeout(search, 150);
    return () => clearTimeout(timer);
  }, [text]);
  const change = (value: string) => {
    setText(value);
    const sameAsBefore = value === site?.name ? site : null;
    onPick(options.find((option) => option.name === value) ?? sameAsBefore);
  };
  return (
    <label className="block"><span className={lbl}>{label}</span>
      <input className="field" list={id} value={text} onChange={(event) => change(event.target.value)}
        autoComplete="off" aria-invalid={!site} />
      <datalist id={id}>{options.map((option) => <option key={option.id} value={option.name} />)}</datalist>
      {!site && <span className="mt-1 block text-body font-semibold text-red">Choose a site from the list.</span>}
    </label>
  );
}

function Buttons({ busy, onClose, left }: { busy: boolean; onClose: () => void; left?: React.ReactNode }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      {left}
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" className="btn btn-p" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    </div>
  );
}

const ERROR_BOX = "mt-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red";

function RegionSelect({ value, onChange, hasRegion }: {
  value: string; onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void; hasRegion: boolean;
}) {
  return (
    <label><span className={lbl}>Region</span>
      <select className="field" value={value} onChange={onChange}>
        {!hasRegion && <option value="">Not set</option>}
        {REGIONS.map((region) => <option key={region}>{region}</option>)}
      </select>
    </label>
  );
}

// Loading line until the item is in, unless loading failed (the error box says so).
function Loading({ error }: { error: string | null }) {
  if (error) {
    return null;
  }
  return <p className="mt-3 text-body text-muted-foreground">Loading…</p>;
}

type SegmentDialogProps = { segmentId: number; focus?: SegmentFocus; onClose: () => void; onSaved: () => void };

export function EditSegmentDialog({ segmentId, focus, onClose, onSaved }: SegmentDialogProps) {
  const {
    segment, form, siteA, setSiteA, siteB, setSiteB, error, setError, busy, pasting, setPasting, surveyInput,
    setField, setCut, setRemarks, copyTotalCores, portsApplied, submit,
  } = useEditSegment(segmentId, focus, onClose, onSaved);
  const pasteButton = (
    <button type="button" className="btn mr-auto" onClick={() => setPasting(true)}>Paste ports</button>
  );
  const title = segment ? `Edit segment ${segment.site_a} - ${segment.site_b}` : "Edit segment";
  return (
    <Dialog title={title} onClose={onClose} wide>
      {error && <p role="alert" className={ERROR_BOX}>{error}</p>}
      {!segment ? <Loading error={error} /> : (
        <form onSubmit={submit} noValidate aria-label="Edit segment">
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label>
              <span className={lbl}>Distance (km)</span>
              <input className="field" type="number" min="0" step="0.001" value={form.distance}
                onChange={setField("distance")} />
            </label>
            <RegionSelect value={form.region} onChange={setField("region")} hasRegion={!!segment.region} />
            <SitePicker label="Site A" site={siteA} onPick={setSiteA} />
            <SitePicker label="Site B" site={siteB} onPick={setSiteB} />
            <label><span className={lbl}>Registered cores</span>
              <span className="flex gap-2">
                <input ref={surveyInput} className="field" type="number" min="0" step="1" value={form.survey}
                  onChange={setField("survey")} placeholder="Not verified" />
                <button type="button" className="btn whitespace-nowrap" onClick={copyTotalCores}>
                  Use total cores
                </button>
              </span>
            </label>
            <label>
              <span className={lbl}>Total cores</span>
              <input className="field" type="number" min="1" step="1" value={form.cable} onChange={setField("cable")} />
            </label>
            <label>
              <span className={lbl}>Route</span>
              <input className="field" value={form.route} onChange={setField("route")} />
            </label>
            <label>
              <span className={lbl}>Cluster</span>
              <input className="field" value={form.section} onChange={setField("section")} />
            </label>
            <label className="col-span-2 flex items-start gap-2 text-body">
              <input type="checkbox" className="mt-0.5 size-4" checked={form.cut}
                onChange={(event) => setCut(event.target.checked)} />
              <span className="font-semibold">Fiber cut</span>
            </label>
            {form.cut !== segment.fiber_cut && (
              <Remarks value={form.remarks} onChange={setRemarks} autoFocus={focus === "restore"} />
            )}
          </div>
          <Buttons busy={busy} onClose={onClose} left={pasteButton} />
          <EditHistory rows={segment.history} />
        </form>
      )}
      {segment && (
        <MapElements owner={{ kind: "segment", id: segmentId, name: `${segment.site_a} - ${segment.site_b}` }}
          onError={setError} />
      )}
      {segment && pasting && (
        <PastePortsDialog segmentId={segmentId} siteA={segment.site_a} siteB={segment.site_b}
          cores={segment.survey_cores ?? 0} onClose={() => setPasting(false)} onApplied={portsApplied} />
      )}
    </Dialog>
  );
}

export function EditSiteDialog({ siteId, onClose, onSaved }: {
  siteId: number; onClose: () => void; onSaved: () => void;
}) {
  const edit = useEditSite(siteId, onClose, onSaved);
  const { site, form, error } = edit;
  return (
    <Dialog title={site ? `Edit site ${site.name}` : "Edit site"} onClose={onClose} wide>
      {error && <p role="alert" className={ERROR_BOX}>{error}</p>}
      {!site ? <Loading error={error} /> : (
        <form onSubmit={edit.submit} noValidate aria-label="Edit site">
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="col-span-2">
              <span className={lbl}>Name</span>
              <input className="field" value={form.name} onChange={edit.setField("name")} />
            </label>
            <label>
              <span className={lbl}>Latitude</span>
              <input className="field" type="number" step="any" min="-90" max="90" value={form.lat}
                onChange={edit.setField("lat")} placeholder="No location" />
            </label>
            <label>
              <span className={lbl}>Longitude</span>
              <input className="field" type="number" step="any" min="-180" max="180" value={form.lon}
                onChange={edit.setField("lon")} placeholder="No location" />
            </label>
            <label>
              <span className={lbl}>Type</span>
              <select className="field" value={form.kind} onChange={edit.setField("kind")}>
                {SITE_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <RegionSelect value={form.region} onChange={edit.setField("region")} hasRegion={!!site.region} />
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="size-4" checked={form.active}
                onChange={(event) => edit.setActive(event.target.checked)} />Active
            </label>
            {!form.active && (
              <p className="col-span-2 -mt-1 text-body font-semibold text-amber">
                Inactive sites are kept, never deleted. A site used by a segment cannot be deactivated.
              </p>
            )}
            <Remarks value={form.remarks} onChange={edit.setRemarks} />
          </div>
          <Buttons busy={edit.busy} onClose={onClose} />
          <EditHistory rows={site.history} />
        </form>
      )}
      {site && <MapElements owner={{ kind: "site", id: siteId, name: site.name }} onError={edit.setError} />}
    </Dialog>
  );
}
