import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon, type IconName } from "@/components/Icon";
import { Changes, Chip, Dialog, FilePick, Note, PAGE_SIZE, Pager } from "@/components/upload-parts";
import { cell, field, uploadError, when } from "@/lib/utils";

type Staged = components["schemas"]["app__ingest__site_master_router__UploadOut"];
type Sheet = components["schemas"]["SheetOut"];
type Applied = components["schemas"]["app__ingest__site_master_router__ApplyOut"];
type Kind = Sheet["kind"];
type Group = "added" | "changed" | "missing" | "problem" | "unchanged";
type Rename = { missing_dc_id: number; missing_dc_name: string; new_dc_name: string; new_row_number: number; new_row_id: number; lrd: string | null };
type Row = {
  id: number; row_number: number | null; key: string; status: string | null; reason: string | null;
  changes: { field: string; old: unknown; new: unknown; protected?: boolean; note?: string }[];
  location_note: string | null; in_use: boolean | null; possible_rename: Rename | null;
  raw: Record<string, unknown> | null;
  parsed: { lat?: number | null; lon?: number | null; lrd?: string | null; details?: Record<string, unknown> } | null;
};
type FileInfo = {
  upload_id: number; filename: string; status: string; uploaded_at: string; applied_at: string | null; uploaded_by: string;
  sheets: Partial<Record<Kind, { sheet_name: string | null; found: boolean; rows: number }>>;
};

const SHEET_LABEL: Record<Kind, string> = { sites: "Site Location", dcs: "DC List" };
const GROUPS: { g: Group; label: string; icon: IconName; cls: string }[] = [
  { g: "added", label: "Added", icon: "ch", cls: "h-green" },
  { g: "changed", label: "Changed", icon: "co", cls: "h-blue" },
  { g: "missing", label: "Missing", icon: "ns", cls: "h-ns" },
  { g: "problem", label: "Problem", icon: "lo", cls: "h-amber" },
  { g: "unchanged", label: "Unchanged", icon: "av", cls: "h-ns" },
];
const willApply = (s: Sheet, override: boolean) => s.found && (!s.blocked || (s.needs_override && override));
const resultLine = (s: Record<string, unknown>) => s.applied
  ? `${s.added} added, ${s.changed} changed, ${s.renamed} renamed, ${s.deactivated} set inactive, ${s.kept_active} missing but kept active, ${s.protected_kept} dashboard edits kept${s.skipped ? `, ${s.skipped} skipped` : ""}.`
  : `not applied (${((s.block_reasons as string[] | undefined) ?? []).join("; ")}).`;

// Current file and previous uploads in one compact table, current first.
function Files({ data }: { data: { current: FileInfo | null; previous: FileInfo[] } | null }) {
  if (!data) return <p className="text-body text-muted-foreground">Loading…</p>;
  const c = data.current;
  const n = (f: FileInfo, k: Kind) => { const x = f.sheets[k]; return x?.found ? x.rows.toLocaleString("en-GB") : <span className="text-muted-foreground">not found</span>; };
  const list = [...(c ? [c] : []), ...data.previous.slice(0, 5)];
  return (
    <section aria-labelledby="sm-files-h" className="mt-5">
      <h3 id="sm-files-h" className="lbl mb-1.5">Uploads</h3>
      {!c && <p className="mb-2 text-body text-muted-foreground">No site master file applied yet.</p>}
      {list.length > 0 && (
        <div className="tbox">
          <table className="tbl band table-fixed [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead><tr><th className="w-[320px]">File</th><th className="w-[260px]">Uploaded</th><th className="w-[120px]">Status</th><th className="num w-[90px]">Sites</th><th className="num w-[90px]">DCs</th><th aria-hidden /></tr></thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.upload_id} data-testid={f === c ? "sm-current" : undefined}>
                  <td className={`truncate ${f === c ? "font-semibold" : ""}`} title={f.filename}>{f.filename}</td>
                  <td className="truncate" title={`${when(f.uploaded_at)} · ${f.uploaded_by}`}>{when(f.uploaded_at)} · {f.uploaded_by}</td>
                  <td>{f === c ? <span className="inline-flex items-center gap-1.5 font-semibold text-green"><Icon name="ch" />Current</span>
                    : f.status === "confirmed" ? <span className="inline-flex items-center gap-1.5"><Icon name="ch" />Applied</span>
                    : <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Icon name="ns" />Staged</span>}</td>
                  <td className="num">{n(f, "sites")}</td>
                  <td className="num">{n(f, "dcs")}</td>
                  <td aria-hidden />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">
        Previous uploads are kept for comparison; there is no undo.{data.previous.length > 5 && ` Showing the latest 5 of ${data.previous.length}.`}
      </p>
    </section>
  );
}

function RowDetail({ r, group }: { r: Row; group: Group }) {
  const empty = !r.reason && group !== "changed" && !r.location_note && group !== "missing" && !r.possible_rename;
  if (empty) return null;
  return (
    <div className="space-y-1">
      {r.reason && <p className="text-body">{r.reason}</p>}
      {group === "changed" && <Changes changes={r.changes} />}
      {r.location_note && <p className="text-body text-muted-foreground">{r.location_note}</p>}
      {group === "missing" && (r.in_use
        ? <span className="inline-flex items-center gap-1.5 font-semibold text-amber"><Icon name="lo" />in use, stays active</span>
        : <span className="text-body text-muted-foreground">will be set inactive (never deleted)</span>)}
      {r.possible_rename && <p className="text-body text-muted-foreground">Possible rename: {r.possible_rename.missing_dc_name} → {r.possible_rename.new_dc_name}</p>}
    </div>
  );
}

function SheetPanel({ uploadId, s, override, onOverride, applied, children }: {
  uploadId: number; s: Sheet; override: boolean; onOverride: (on: boolean) => void; applied: boolean; children?: React.ReactNode;
}) {
  const first = GROUPS.find((x) => s.counts[x.g] > 0)?.g ?? "added";
  const [group, setGroup] = useState<Group>(first);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!s.found) return;
    let stale = false;
    api.get("/api/admin/site-master/uploads/{upload_id}/rows", { path: { upload_id: uploadId }, query: { sheet: s.kind, group, page, page_size: PAGE_SIZE } })
      .then((d) => { if (!stale) { setData({ total: d.total, items: d.items as unknown as Row[] }); setError(null); } })
      .catch((e) => !stale && setError(errorText(e, "Could not load rows.")));
    return () => { stale = true; };
  }, [uploadId, s.kind, s.found, group, page]);
  const g = GROUPS.find((x) => x.g === group)!;
  const hid = `sm-${s.kind}-h`;
  return (
    <section aria-labelledby={hid} data-testid={`sheet-${s.kind}`}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h3 id={hid} className="text-[15px] font-semibold">{SHEET_LABEL[s.kind]}</h3>
        <span className="text-body text-muted-foreground">
          {s.found ? <>found as worksheet <b className="font-semibold text-foreground">“{s.sheet_name}”</b>, {s.counts.rows.toLocaleString("en-GB")} rows</> : "worksheet not found"}
        </span>
        {applied && <span className="pill h-green"><Icon name="ch" />Applied</span>}
      </div>
      {!applied && s.blocked && !s.needs_override && (
        <div className="mb-3"><Note tone="red" role="alert" title="This sheet will not be applied">
          <ul className="list-disc pl-4">{s.block_reasons.map((b) => <li key={b}>{b}</li>)}</ul>
        </Note></div>
      )}
      {!applied && s.needs_override && (
        <div className="mb-3"><Note tone="amber" title={override ? "Override chosen: this sheet will be applied" : "Blocked: this sheet will not be applied unless you override"}>
          <ul className="list-disc pl-4">{s.block_reasons.map((b) => <li key={b}>{b}</li>)}</ul>
          <label className="mt-2 flex items-center gap-2 font-medium">
            <input type="checkbox" className="size-4" checked={override} onChange={(e) => onOverride(e.target.checked)} />
            Override: the file really has fewer rows; apply this sheet anyway
          </label>
        </Note></div>
      )}
      {s.found && (
        <>
          <div role="group" aria-label={`${SHEET_LABEL[s.kind]} rows by result`} className="mb-3 flex flex-wrap gap-2">
            {GROUPS.map((x) => <Chip key={x.g} label={x.label} icon={x.icon} n={s.counts[x.g]} pressed={group === x.g} onClick={() => { setGroup(x.g); setPage(1); }} />)}
          </div>
          {error && <p role="alert" className="text-body font-semibold text-red">{error}</p>}
          {data && (data.total === 0 ? <p className="text-body text-muted-foreground">No {g.label.toLowerCase()} rows.</p> : (
            <>
              <div className="tbox">
              <table className="tbl band table-fixed" aria-label={`${SHEET_LABEL[s.kind]}: ${g.label} rows`}>
                <thead><tr>
                  <th scope="col" className="num w-16">Row</th>
                  <th scope="col" className="w-[22%]">{s.kind === "sites" ? "Site name" : "DC name"}</th>
                  {s.kind === "dcs" && <><th scope="col" className="w-[16%]">LRD</th><th scope="col" className="w-[10%]">State</th></>}
                  <th scope="col" className="num w-24">Latitude</th>
                  <th scope="col" className="num w-24">Longitude</th>
                  <th scope="col">Status or reason</th>
                </tr></thead>
                <tbody>
                  {data.items.map((r) => {
                    const tx = (v: string) => <td className="truncate" title={v === "—" ? undefined : v}>{v}</td>;
                    return (
                      <tr key={r.id}>
                        <td className="num text-muted-foreground">{r.row_number ?? "—"}</td>
                        <th scope="row" className="truncate text-left font-semibold" title={r.key || undefined}>{r.key || <i className="font-normal text-muted-foreground">blank</i>}</th>
                        {s.kind === "dcs" && <>{tx(cell(r.parsed?.lrd, field(r.raw, /^lrd$/i)))}{tx(cell(field(r.parsed?.details, /^(state|city)$/i), null))}</>}
                        <td className="num truncate">{cell(r.parsed?.lat, field(r.raw, /^lat/i))}</td>
                        <td className="num truncate">{cell(r.parsed?.lon, field(r.raw, /^lon/i))}</td>
                        <td className="whitespace-normal! [&:has(*)]:h-auto! [&:has(*)]:py-1.5!">
                          <span className={`inline-flex items-center gap-1.5 ${g.cls === "h-amber" ? "font-semibold text-amber" : ""}`}><Icon name={g.icon} />{group === "problem" ? "Needs review" : g.label}</span>
                          <RowDetail r={r} group={group} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <Pager total={data.total} page={page} onPage={setPage} />
            </>
          ))}
        </>
      )}
      {children}
    </section>
  );
}

function Renames({ list, decisions, onDecide }: { list: Rename[]; decisions: Record<number, "rename" | "separate">; onDecide: (id: number, d: "rename" | "separate") => void }) {
  return (
    <section aria-labelledby="sm-ren-h">
      <h3 id="sm-ren-h" className="text-[15px] font-semibold">Possible renames <span className="font-normal text-muted-foreground">({list.length}, each needs a choice)</span></h3>
      <p className="mb-3 text-body text-muted-foreground">A DC is missing from the file and a new DC has the same LRD and coordinates. Rename keeps the existing DC and its history under the new name; Keep separate adds the new DC and sets the missing one inactive.</p>
      <ul className="tbox divide-y divide-rule">
        {list.map((r) => (
          <li key={r.missing_dc_id}>
            <fieldset className="flex flex-wrap items-center gap-x-6 gap-y-1 px-3 py-2 text-body">
              <legend className="sr-only">{r.missing_dc_name} to {r.new_dc_name}</legend>
              <span className="min-w-[340px] flex-1"><b className="font-semibold">{r.missing_dc_name}</b> → <b className="font-semibold">{r.new_dc_name}</b>
                <span className="text-muted-foreground"> · LRD {r.lrd ?? "—"} · file row {r.new_row_number}</span></span>
              {(["rename", "separate"] as const).map((d) => (
                <label key={d} className="flex items-center gap-2 font-medium">
                  <input type="radio" name={`ren-${r.missing_dc_id}`} className="size-4" checked={decisions[r.missing_dc_id] === d} onChange={() => onDecide(r.missing_dc_id, d)} />
                  {d === "rename" ? "Rename" : "Keep separate"}
                </label>
              ))}
              {!decisions[r.missing_dc_id] && <span className="inline-flex items-center gap-1.5 font-semibold text-amber"><Icon name="lo" />Choose one</span>}
            </fieldset>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SiteMasterUpload() {
  const [cur, setCur] = useState<{ current: FileInfo | null; previous: FileInfo[] } | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<Kind, boolean>>({ sites: false, dcs: false });
  const [reason, setReason] = useState<Record<Kind, string>>({ sites: "", dcs: "" });
  const [decisions, setDecisions] = useState<Record<number, "rename" | "separate">>({});
  const [confirming, setConfirming] = useState<Kind | null>(null);
  const [done, setDone] = useState<Partial<Record<Kind, Applied>>>({}); // sheets applied from this upload while others remain
  const [result, setResult] = useState<Applied | null>(null);
  const [addOnly, setAddOnly] = useState(false);

  const loadCurrent = useCallback(() => {
    api.get("/api/admin/site-master/current").then((d) => setCur(d as unknown as typeof cur)).catch(() => {});
  }, []);
  useEffect(loadCurrent, [loadCurrent]);

  const pick = async (f: File) => {
    setBusy(true); setError(null); setResult(null); setStaged(null); setDone({}); setConfirming(null);
    setOverride({ sites: false, dcs: false }); setReason({ sites: "", dcs: "" }); setDecisions({});
    try {
      setStaged((await api.postFile("/api/admin/site-master/uploads", f, { add_only: String(addOnly) })) as Staged);
      loadCurrent();
    } catch (e) {
      setError(uploadError(e));
    } finally {
      setBusy(false);
    }
  };

  const sheets = staged?.sheets ?? [];
  const renames = (staged?.possible_renames ?? []) as Rename[];
  const undecided = renames.filter((r) => !decisions[r.missing_dc_id]).length;
  const overriding = (s: Sheet) => s.needs_override && override[s.kind];
  const why = (s: Sheet) => !willApply(s, override[s.kind]) ? "Tick Override to apply this sheet."
    : s.kind === "dcs" && undecided ? `Choose Rename or Keep separate for ${undecided} possible ${undecided === 1 ? "rename" : "renames"}.`
    : overriding(s) && !reason[s.kind].trim() ? "Enter a reason for the override."
    : null;
  // DC rows find their LRD among sites already saved, so a new Site Location sheet should go first.
  const sitesPending = sheets.some((s) => s.kind === "sites" && s.found) && !done.sites;

  const apply = async (k: Kind) => {
    const s = sheets.find((x) => x.kind === k);
    if (!staged || !s) return;
    setError(null);
    try {
      const r = await api.post("/api/admin/site-master/uploads/{upload_id}/apply", {
        path: { upload_id: staged.upload_id },
        body: {
          sheets: [k],
          override_drop: { sites: k === "sites" && override.sites, dcs: k === "dcs" && override.dcs },
          reason: overriding(s) ? reason[k].trim() : null,
          renames: k === "dcs" ? renames.map((x) => ({ missing_dc_id: x.missing_dc_id, new_row_id: x.new_row_id, decision: decisions[x.missing_dc_id] })) : [],
        },
      });
      setConfirming(null);
      if (r.complete) {
        setStaged(null); setDone({});
        setResult({ ...r, warnings: [...Object.values(done).flatMap((d) => d.warnings), ...r.warnings] });
      } else {
        setDone((d) => ({ ...d, [k]: r }));
        requestAnimationFrame(() => document.getElementById(`sm-${k}-done`)?.focus()); // the Apply button is gone
      }
      loadCurrent();
    } catch (e) {
      setConfirming(null);
      setError(errorText(e, "Apply failed. Nothing was changed. Try again."));
    }
  };

  const footer = (s: Sheet) => {
    const k = s.kind;
    const d = done[k];
    if (d) return (
      <div id={`sm-${k}-done`} tabIndex={-1} className="mt-4 outline-none">
        <Note tone="green" role="status" title={`${SHEET_LABEL[k]} applied`}>
          <p>{resultLine(d.sheets[k])}</p>
          {d.warnings.length > 0 && <ul className="mt-1 list-disc pl-4">{d.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </Note>
      </div>
    );
    if (!s.found || (s.blocked && !s.needs_override)) return null; // the red note already says it will not be applied
    const w = why(s);
    return (
      <>
        {k === "dcs" && renames.length > 0 && <div className="mt-4"><Renames list={renames} decisions={decisions} onDecide={(id, x) => setDecisions((o) => ({ ...o, [id]: x }))} /></div>}
        <div className="mt-4 flex flex-wrap items-end gap-4 border-t pt-4">
          {overriding(s) && (
            <label className="w-[420px]"><span className="lbl mb-1 block text-body! text-foreground!">Reason for the override (required)</span>
              <input className="field" value={reason[k]} onChange={(e) => setReason((o) => ({ ...o, [k]: e.target.value }))} />
            </label>
          )}
          <button type="button" className="btn btn-p" disabled={!!w} aria-describedby={`sm-${k}-why`} onClick={() => setConfirming(k)}>Apply {SHEET_LABEL[k]}…</button>
          <div id={`sm-${k}-why`} className="text-body text-muted-foreground">
            <p>{w ?? "Ready to apply."}</p>
            {k === "dcs" && sitesPending && <p>Apply Site Location first: DCs whose LRD site is not saved yet are skipped.</p>}
          </div>
        </div>
      </>
    );
  };

  const c = sheets.find((s) => s.kind === confirming);
  return (
    <div className="space-y-4">
    <section className="card" aria-labelledby="sm-h">
      <div className="card-h">
        <h2 id="sm-h">Site master workbook</h2>
        <small className="hint">Sites and DCs. The file replaces the site list: rows missing from it are set inactive, never deleted.</small>
      </div>
      <div className="space-y-4">
        <FilePick label="Upload a site master workbook" busy={busy} onFile={pick} />
        <div>
          <label className="flex w-fit items-center gap-2 text-body font-medium">
            <input type="checkbox" className="size-4" checked={addOnly} onChange={(e) => setAddOnly(e.target.checked)} aria-describedby="sm-add-only-hint" />
            Add and update only
          </label>
          <p id="sm-add-only-hint" className="mt-0.5 pl-6 text-xs text-muted-foreground">Use for a hand-picked list. Sites that are not in the file stay active.</p>
        </div>
        {error && <Note tone="red" role="alert" title={error} />}
        <div aria-live="polite" data-testid="sm-result">
          {result && (
            <Note tone="green" title="Site master applied">
              <ul className="space-y-0.5">
                {(["sites", "dcs"] as Kind[]).map((k) => <li key={k}><b className="font-semibold">{SHEET_LABEL[k]}:</b> {resultLine(result.sheets[k] ?? {})}</li>)}
              </ul>
              {result.warnings.length > 0 && (
                <><p className="mt-2 font-semibold">Warnings</p><ul className="list-disc pl-4">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul></>
              )}
            </Note>
          )}
        </div>
      </div>
      <Files data={cur} />
    </section>
    {staged && (
      <section aria-labelledby="sm-prev-title" className="card" data-testid="sm-preview">
        <div className="card-h">
          <h2 id="sm-prev-title" className="truncate">Preview of {staged.filename}</h2>
          <small className="hint flex-none">Each sheet is applied on its own. Nothing is saved until you apply it.</small>
        </div>
        <div className="space-y-6">
          {staged.add_only && <p className="text-body text-muted-foreground">Add and update only: sites not in this file are kept.</p>}
          {sheets.map((s) => (
            <SheetPanel key={`${staged.upload_id}-${s.kind}`} uploadId={staged.upload_id} s={s} applied={!!done[s.kind]}
              override={override[s.kind]} onOverride={(on) => setOverride((o) => ({ ...o, [s.kind]: on }))}>
              {footer(s)}
            </SheetPanel>
          ))}
          <div className="border-t pt-4">
            <button type="button" className="btn" onClick={() => { setStaged(null); setDone({}); }}>Discard preview</button>
          </div>
        </div>
      </section>
    )}
      {c && staged && (
        <Dialog title={`Apply ${SHEET_LABEL[c.kind]}?`} onClose={() => setConfirming(null)} wide>
          <ul className="mt-3 space-y-2 text-body">
            <li>Add {c.counts.added}, update {c.counts.changed}; {c.counts.missing} missing are set inactive unless a span or reservation uses them (those stay active with a warning); {c.counts.problem} problem rows are not applied.{c.needs_override ? " Row-count block overridden." : ""}</li>
            {c.kind === "dcs" && renames.length > 0 && (
              <li><b className="font-semibold">Possible renames:</b> {renames.filter((r) => decisions[r.missing_dc_id] === "rename").length} renamed, {renames.filter((r) => decisions[r.missing_dc_id] === "separate").length} kept separate.</li>
            )}
            {c.kind === "dcs" && sitesPending && <li>Site Location is not applied yet: DCs whose LRD site is not saved are skipped.</li>}
          </ul>
          <p className="mt-3 text-body text-muted-foreground">Changes are saved in one step with a history record per field. There is no undo.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setConfirming(null)}>Cancel</button>
            <button type="button" className="btn btn-p" onClick={() => apply(c.kind)} autoFocus>Apply</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
