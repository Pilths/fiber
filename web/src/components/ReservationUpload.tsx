import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import { Icon, type IconName } from "@/components/Icon";
import { Changes, Chip, Dialog, FilePick, Note, PAGE_SIZE, Pager } from "@/components/upload-parts";
import { plural, uploadError, when } from "@/lib/utils";

// The Reservation workbook endpoints return plain JSON (no response models), so their shapes are written here.
type Group = "new" | "changed" | "unchanged" | "missing" | "reservations" | "conflicts" | "already_imported" | "ignored" | "needs_review" | "rejected";
type Warning = { kind: string; message: string; rows: number[] };
type Preview = { upload_id: number; filename: string; counts: Record<Group, number>; warnings: Warning[]; switch_closed: boolean };
type Change = { field: "region" | "distance_km" | "survey_cores"; old: unknown; new: unknown; protected: boolean; note?: string; blocked?: string };
type Shown = { customer: string | null; span: string; cores: number; count_only: number | null; planned_date: string | null; group_label: string | null; additional: boolean | null; ports: [string, string[]][] | null };
type Data = {
  reservation?: Shown | null; key?: string; rows?: number[]; fields?: Record<string, unknown>; changes?: Change[];
  measurements?: unknown[]; matched_reservation_id?: number;
};
type Row = { id: number; row_number: number | null; sheet_name: string | null; status: string | null; reason: string | null; warnings: string[]; data: Data };
type Result = { counts: Record<string, number>; skipped: { row_number: number; reason: string }[]; warnings: Warning[]; ignored_reservation_rows: number };
type Switch = { closed: boolean; closed_at: string | null; closed_by: string | null; reason: string | null };

const GROUP: Record<Group, { label: string; icon: IconName; cls: string; word: string }> = {
  new: { label: "New spans", icon: "ch", cls: "h-green", word: "New span" },
  changed: { label: "Changed spans", icon: "co", cls: "h-blue", word: "Changed" },
  unchanged: { label: "Unchanged", icon: "av", cls: "h-ns", word: "Unchanged" },
  missing: { label: "Not in this file", icon: "ns", cls: "h-ns", word: "Not in file, untouched" },
  reservations: { label: "Reservations", icon: "ch", cls: "h-green", word: "Will import" },
  conflicts: { label: "Conflicts", icon: "fl", cls: "h-red", word: "Conflict, skipped" },
  already_imported: { label: "Already imported", icon: "ch", cls: "h-ns", word: "Already imported" },
  ignored: { label: "Ignored", icon: "ns", cls: "h-ns", word: "Ignored" },
  needs_review: { label: "Needs review", icon: "lo", cls: "h-amber", word: "Needs review" },
  rejected: { label: "Rejected", icon: "fl", cls: "h-red", word: "Rejected" },
};
const OTHER: Group[] = ["new", "changed", "unchanged", "missing", "conflicts", "already_imported", "ignored", "needs_review", "rejected"];
const SPAN_GROUPS: Group[] = ["new", "changed", "unchanged", "missing"];
const FIELD: Record<string, string> = { region: "Region", distance_km: "Distance (km)", survey_cores: "Surveyed cores" };

const TEXT: Record<string, string> = { "h-red": "font-semibold text-red", "h-amber": "font-semibold text-amber", "h-green": "text-green", "h-blue": "text-blue", "h-ns": "text-muted-foreground" };
const Pill = ({ g }: { g: Group }) => <span className={`inline-flex items-center gap-1.5 ${TEXT[GROUP[g].cls]}`}><Icon name={GROUP[g].icon} />{GROUP[g].word}</span>;
const date = (d: string | null) => d ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(d)) : "—";
const ports = (p: Shown["ports"]) => p?.length
  ? p.map(([, labels]) => labels.length > 1 ? `${labels[0]} … ${labels[labels.length - 1]}` : labels[0]).join(" ↔ ")
  : "—";
const cores = (s: Shown) => s.count_only ? `count only ${s.count_only}` : `${s.cores} ${s.cores === 1 ? "core" : "cores"}`;

function useRows(uploadId: number, group: Group, page: number) {
  const [data, setData] = useState<{ total: number; items: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    api.get("/api/admin/uploads/{upload_id}/rows", { path: { upload_id: uploadId }, query: { group, page, page_size: PAGE_SIZE } })
      .then((d) => { if (!stale) { setData(d as unknown as { total: number; items: Row[] }); setError(null); } })
      .catch((e) => !stale && setError(errorText(e, "Could not load rows.")));
    return () => { stale = true; };
  }, [uploadId, group, page]);
  return { data, error };
}

function ImportSwitch({ state, onClosed }: { state: Switch | null; onClosed: (s: Switch) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!state) return null;
  if (state.closed) {
    return (
      <p data-testid="import-switch" role="status" className="text-body">
        <span className="inline-flex items-center gap-1.5 font-semibold text-amber"><Icon name="lo" />Reservation import closed on {when(state.closed_at)} by {state.closed_by}: {state.reason}</span>
      </p>
    );
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) { setError("Enter a reason for closing the import."); return; }
    try {
      onClosed(await api.post("/api/admin/reservation-import/close", { body: { reason: reason.trim() } }) as unknown as Switch);
      setOpen(false);
    } catch (err) {
      setError(errorText(err, "Could not close the import. Try again."));
    }
  };
  return (
    <div data-testid="import-switch" className="flex items-center gap-3 text-body">
      <span className="inline-flex items-center gap-1.5 font-semibold text-green"><Icon name="ch" />Import open</span>
      <button type="button" className="btn btn-sm ml-auto" onClick={() => { setOpen(true); setReason(""); setError(null); }}>Close reservation import…</button>
      {open && (
        <Dialog title="Close reservation import?" onClose={() => setOpen(false)}>
          <form onSubmit={submit} noValidate>
            <p className="mt-1 text-body text-muted-foreground">After closing, reservation rows in uploaded workbooks are ignored and new reservations are made only in the dashboard. This is one-time: there is no way to reopen it.</p>
            {error && <p role="alert" className="mt-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">{error}</p>}
            <label className="mt-4 block"><span className="lbl mb-1 block text-body! text-foreground!">Reason (required)</span>
              <textarea className="field h-20! py-2" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus aria-invalid={!!error && !reason.trim()} />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-danger">Close import</button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function Reservations({ uploadId, total }: { uploadId: number; total: number }) {
  const [page, setPage] = useState(1);
  const { data, error } = useRows(uploadId, "reservations", page);
  return (
    <section aria-labelledby="ru-res-h" data-testid="ru-reservations">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h3 id="ru-res-h" className="text-[15px] font-semibold">Reservations to import <span className="font-normal text-muted-foreground">({total.toLocaleString("en-GB")})</span></h3>
      </div>
      {error && <p role="alert" className="text-body font-semibold text-red">{error}</p>}
      {data && (data.total === 0 ? <p className="text-body text-muted-foreground">No reservation rows will be imported.</p> : (
        <>
          <div className="tbox">
          <table className="tbl band" aria-label="Reservations to import">
            <thead><tr><th className="num w-px">Row</th><th>Customer</th><th>Span</th><th className="num w-px">Cores</th><th className="w-px">Planned date</th><th>Group</th><th className="w-px">Additional</th><th>Ports</th></tr></thead>
            <tbody>
              {data.items.map((r) => {
                const s = r.data.reservation!;
                return (
                  <tr key={r.id}>
                    <td className="num text-muted-foreground">{r.row_number}</td>
                    <th scope="row" className="text-left font-semibold">{s.customer}</th>
                    <td>{s.span}</td>
                    <td className="num">{cores(s)}</td>
                    <td>{date(s.planned_date)}{r.warnings.length > 0 && <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-amber" title={r.warnings.join("; ")}><Icon name="lo" />{r.warnings.length === 1 ? r.warnings[0] : `${r.warnings.length} warnings`}</span>}</td>
                    <td>{s.group_label ?? "—"}</td>
                    <td>{s.additional ? "Yes" : "No"}</td>
                    <td className="max-w-[260px] truncate" title={ports(s.ports)}>{ports(s.ports)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <Pager total={data.total} page={page} onPage={setPage} />
        </>
      ))}
    </section>
  );
}

function GroupRows({ uploadId, counts, wins, onWin }: { uploadId: number; counts: Record<Group, number>; wins: Set<string>; onWin: (k: string, on: boolean) => void }) {
  const [group, setGroup] = useState<Group>(OTHER.find((g) => g !== "missing" && g !== "unchanged" && counts[g] > 0) ?? "unchanged");
  const [page, setPage] = useState(1);
  const { data, error } = useRows(uploadId, group, page);
  const span = SPAN_GROUPS.includes(group);
  return (
    <section aria-labelledby="ru-rows-h" data-testid="ru-groups">
      <h3 id="ru-rows-h" className="mb-2 text-[15px] font-semibold">Rows by group</h3>
      <div role="group" aria-label="Groups" className="mb-3 flex flex-wrap gap-2">
        {OTHER.map((g) => <Chip key={g} label={GROUP[g].label} icon={GROUP[g].icon} n={counts[g]} pressed={group === g} onClick={() => { setGroup(g); setPage(1); }} />)}
      </div>
      {error && <p role="alert" className="text-body font-semibold text-red">{error}</p>}
      {data && (data.total === 0 ? <p className="text-body text-muted-foreground">No rows in {GROUP[group].label}.</p> : (
        <>
          <div className="tbox">
          <table className="tbl band" aria-label={`${GROUP[group].label} rows`}>
            <thead><tr>{span ? <><th>Span</th><th>File rows</th></> : <><th className="num w-px">Row</th><th className="w-px">Sheet</th></>}<th className="w-px">Status</th><th>Details</th></tr></thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id} className="align-top [&>*]:py-2.5! [&>*]:h-auto!">
                  {span
                    ? <><th scope="row" className="text-left font-semibold">{r.data.key}</th><td className="text-muted-foreground">{r.data.rows?.join(", ") ?? "—"}</td></>
                    : <><td className="num text-muted-foreground">{r.row_number}</td><td className="text-muted-foreground">{r.sheet_name}</td></>}
                  <td><Pill g={group} /></td>
                  <td className="whitespace-normal!">
                    {r.reason && <p>{r.reason}</p>}
                    {r.data.reservation && !span && <p className="text-muted-foreground">{r.data.reservation.customer ?? "no customer"} · {r.data.reservation.span} · {cores(r.data.reservation)}</p>}
                    {group === "new" && r.data.fields && <p>{Object.entries(r.data.fields).map(([k, v]) => `${FIELD[k] ?? k} ${v}`).join(" · ") || "No span values in the file"}</p>}
                    {r.data.changes && r.data.changes.length > 0 && (
                      <Changes changes={r.data.changes.map((c) => ({ ...c, field: FIELD[c.field] ?? c.field }))} extra={(i) => {
                        const c = r.data.changes![i];
                        if (!c.protected || c.blocked) return null;
                        const k = `${r.id}:${c.field}`;
                        return <label className="ml-3 inline-flex items-center gap-1.5 font-medium"><input type="checkbox" className="size-4" checked={wins.has(k)} onChange={(e) => onWin(k, e.target.checked)} />Use Excel value</label>;
                      }} />
                    )}
                    {!!r.data.measurements?.length && <p className="text-muted-foreground">{r.data.measurements.length} new loss {r.data.measurements.length === 1 ? "measurement" : "measurements"} appended</p>}
                    {r.warnings?.filter((w) => w !== r.reason).map((w) => <p key={w} className="flex items-center gap-1.5 text-amber"><Icon name="lo" />{w}</p>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pager total={data.total} page={page} onPage={setPage} />
        </>
      ))}
    </section>
  );
}

// Warnings as one quiet list: the first 3, then "Show all".
function Warnings({ list }: { list: Warning[] }) {
  const [all, setAll] = useState(false);
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, 3);
  return (
    <section aria-labelledby="ru-warn-h" className="text-body">
      <h3 id="ru-warn-h" className="inline-flex items-center gap-1.5 font-semibold text-amber"><Icon name="lo" />{list.length} {list.length === 1 ? "warning" : "warnings"}</h3>
      <ul className="mt-1 list-disc space-y-0.5 pl-9" aria-label="Warnings">{shown.map((w, i) => <li key={i} data-kind={w.kind}>{w.message}</li>)}</ul>
      {list.length > 3 && (
        <button type="button" className="mt-1 ml-5 font-semibold text-blue underline underline-offset-2" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </section>
  );
}

export function ReservationUpload() {
  const [sw, setSw] = useState<Switch | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wins, setWins] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const loadSwitch = useCallback(() => { api.get("/api/admin/reservation-import").then((s) => setSw(s as unknown as Switch)).catch(() => {}); }, []);
  useEffect(loadSwitch, [loadSwitch]);

  const pick = async (f: File) => {
    setBusy(true); setError(null); setResult(null); setPreview(null); setWins(new Set());
    try {
      setPreview((await api.postFile("/api/admin/uploads", f)) as Preview);
    } catch (e) {
      setError(uploadError(e));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!preview) return;
    try {
      const excel_wins = [...wins].map((k) => { const [id, field] = k.split(":"); return { row_id: Number(id), field: field as Change["field"] }; });
      const r = await api.post("/api/admin/uploads/{upload_id}/confirm", { path: { upload_id: preview.upload_id }, body: { excel_wins } });
      setConfirming(false); setPreview(null); setResult(r as unknown as Result);
    } catch (e) {
      setConfirming(false);
      setError(errorText(e, "Confirm failed. Nothing was saved. Try again."));
    }
  };
  const c = preview?.counts;
  const notImported = c ? c.already_imported + c.ignored + c.needs_review + c.rejected : 0;

  return (
    <div className="space-y-4">
    <section className="card" aria-labelledby="ru-h">
      <div className="card-h">
        <h2 id="ru-h">Reservation workbook</h2>
      </div>
      <div className="space-y-4">
        <FilePick label="Upload a Reservation workbook" busy={busy} onFile={pick} />
        <ImportSwitch state={sw} onClosed={setSw} />
        {error && <Note tone="red" role="alert" title={error} />}
        <div aria-live="polite" data-testid="ru-result">
          {result && (
            <Note tone="green" title="Upload confirmed">
              <p>
                {plural(result.counts.reservations, "reservation")} imported, {plural(result.counts.spans, "new span")}, {plural(result.counts.span_updates, "span field")} updated,{" "}
                {plural(result.counts.cores, "core")}, {plural(result.counts.ports, "port")} and {plural(result.counts.customers, "customer")} added, {plural(result.counts.measurements, "measurement")} appended{result.ignored_reservation_rows ? `, ${plural(result.ignored_reservation_rows, "reservation row")} ignored (import closed)` : ""}.
              </p>
              {result.skipped.length > 0 && (
                <><p className="mt-2 font-semibold">Skipped rows</p><ul className="list-disc pl-4">{result.skipped.map((s) => <li key={s.row_number}>Row {s.row_number}: {s.reason}</li>)}</ul></>
              )}
              {result.warnings.length > 0 && (
                <><p className="mt-2 font-semibold">Warnings</p><ul className="list-disc pl-4">{result.warnings.slice(0, 20).map((w, i) => <li key={i}>{w.message}</li>)}</ul>
                  {result.warnings.length > 20 && <p>and {result.warnings.length - 20} more.</p>}</>
              )}
            </Note>
          )}
        </div>
      </div>
    </section>
    {preview && c && (
      <section aria-labelledby="ru-prev-h" className="card" data-testid="ru-preview">
        <div className="card-h">
          <h2 id="ru-prev-h" className="truncate">Preview of {preview.filename}</h2>
        </div>
        <div className="space-y-6">
          <p className="-mt-2 text-body">
            {preview.switch_closed ? "Reservation import is closed: reservation rows are ignored." : `${plural(c.reservations, "reservation")} will be imported; ${plural(notImported, "row")} will not be imported.`}
          </p>
          <Warnings list={preview.warnings} />
          <Reservations uploadId={preview.upload_id} total={c.reservations} />
          <GroupRows uploadId={preview.upload_id} counts={c} wins={wins} onWin={(k, on) => setWins((w) => { const n = new Set(w); if (on) n.add(k); else n.delete(k); return n; })} />
          <div className="flex items-center gap-4 border-t pt-4">
            <button type="button" className="btn btn-p" onClick={() => setConfirming(true)}>Confirm import…</button>
            <button type="button" className="btn" onClick={() => setPreview(null)}>Discard preview</button>
          </div>
        </div>
      </section>
    )}
      {confirming && c && (
        <Dialog title="Confirm this upload?" onClose={() => setConfirming(false)} wide>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-body">
            <li>Import <b>{plural(c.reservations, "reservation")}</b> as approved.</li>
            <li>Add <b>{c.new}</b> new spans; update <b>{c.changed}</b> changed spans{wins.size ? ` (Excel value used for ${wins.size} dashboard-edited ${wins.size === 1 ? "field" : "fields"})` : " (dashboard-edited fields keep the dashboard value)"}.</li>
            <li>Skip <b>{c.conflicts}</b> conflicts; <b>{notImported}</b> rows are not imported (already imported, ignored, needs review, rejected).</li>
            <li><b>{c.missing}</b> spans not in this file stay as they are.</li>
          </ul>
          <p className="mt-3 text-body text-muted-foreground">Everything is saved in one step. Existing reservations are never changed.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="btn btn-p" onClick={confirm} autoFocus>Confirm</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
