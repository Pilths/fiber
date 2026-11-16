import { Icon, type IconName } from "@/components/Icon";
import { Changes, Chip, Dialog, FilePick, Note, Pager } from "@/components/upload-parts";
import {
  useSheetRows,
  useSiteMasterUpload,
  type FileInfo,
  type Group,
  type Row,
  type Sheet,
  type SiteMasterUploadState,
  type Uploads,
} from "@/lib/useSiteMasterUpload";
import { cell, field, when } from "@/lib/utils";

const SHEET_LABEL = "Site Location";
const GROUPS: { g: Group; label: string; icon: IconName; cls: string }[] = [
  { g: "added", label: "Added", icon: "ch", cls: "h-green" },
  { g: "changed", label: "Changed", icon: "co", cls: "h-blue" },
  { g: "missing", label: "Missing", icon: "ns", cls: "h-ns" },
  { g: "problem", label: "Problem", icon: "lo", cls: "h-amber" },
  { g: "unchanged", label: "Unchanged", icon: "av", cls: "h-ns" },
];

function resultLine(summary: Record<string, unknown>): string {
  if (!summary.applied) {
    const reasons = (summary.block_reasons as string[] | undefined) ?? [];
    return `not applied (${reasons.join("; ")}).`;
  }
  const skipped = summary.skipped ? `, ${summary.skipped} skipped` : "";
  return `${summary.added} added, ${summary.changed} changed, `
    + `${summary.deactivated} set inactive, ${summary.kept_active} missing but kept active, `
    + `${summary.protected_kept} dashboard edits kept${skipped}.`;
}

function sheetRows(file: FileInfo) {
  const sheet = file.sheets.sites;
  if (sheet?.found) {
    return sheet.rows.toLocaleString("en-GB");
  }
  return <span className="text-muted-foreground">not found</span>;
}

function FileStatus({ file, isCurrent }: { file: FileInfo; isCurrent: boolean }) {
  if (isCurrent) {
    return <span className="inline-flex items-center gap-1.5 font-semibold text-green"><Icon name="ch" />Current</span>;
  }
  if (file.status === "confirmed") {
    return <span className="inline-flex items-center gap-1.5"><Icon name="ch" />Applied</span>;
  }
  return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Icon name="ns" />Staged</span>;
}

// Current file and previous uploads in one compact table, current first.
function Files({ data }: { data: Uploads | null }) {
  if (!data) {
    return <p className="text-body text-muted-foreground">Loading…</p>;
  }
  const c = data.current;
  const list = [...(c ? [c] : []), ...data.previous.slice(0, 5)];
  return (
    <section aria-labelledby="sm-files-h" className="mt-5">
      <h3 id="sm-files-h" className="lbl mb-1.5">Uploads</h3>
      {!c && <p className="mb-2 text-body text-muted-foreground">No site master file applied yet.</p>}
      {list.length > 0 && (
        <div className="tbox">
          <table className="tbl band table-fixed [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead><tr><th className="w-[320px]">File</th><th className="w-[260px]">Uploaded</th><th className="w-[120px]">Status</th><th className="num w-[90px]">Sites</th><th aria-hidden /></tr></thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.upload_id} data-testid={f === c ? "sm-current" : undefined}>
                  <td className={`truncate ${f === c ? "font-semibold" : ""}`} title={f.filename}>{f.filename}</td>
                  <td className="truncate" title={`${when(f.uploaded_at)} · ${f.uploaded_by}`}>{when(f.uploaded_at)} · {f.uploaded_by}</td>
                  <td><FileStatus file={f} isCurrent={f === c} /></td>
                  <td className="num">{sheetRows(f)}</td>
                  <td aria-hidden />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.previous.length > 5 && <p className="mt-1.5 text-xs text-muted-foreground">Showing the latest 5 of {data.previous.length} previous uploads.</p>}
    </section>
  );
}

function RowDetail({ r, group }: { r: Row; group: Group }) {
  const empty = !r.reason && group !== "changed" && group !== "missing";
  if (empty) {
    return null;
  }
  return (
    <div className="space-y-1">
      {r.reason && <p className="text-body">{r.reason}</p>}
      {group === "changed" && <Changes changes={r.changes} />}
      {group === "missing" && (r.in_use
        ? <span className="inline-flex items-center gap-1.5 font-semibold text-amber"><Icon name="lo" />in use, stays active</span>
        : <span className="text-body text-muted-foreground">will be set inactive (never deleted)</span>)}
    </div>
  );
}

function SheetPanel({ uploadId, s, override, onOverride, children }: {
  uploadId: number; s: Sheet; override: boolean; onOverride: (on: boolean) => void; children?: React.ReactNode;
}) {
  const first = GROUPS.find((x) => s.counts[x.g] > 0)?.g ?? "added";
  const { group, page, setPage, data, error, chooseGroup } = useSheetRows(uploadId, s, first);
  const g = GROUPS.find((x) => x.g === group)!;
  const hid = `sm-${s.kind}-h`;
  return (
    <section aria-labelledby={hid} data-testid={`sheet-${s.kind}`}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h3 id={hid} className="text-[15px] font-semibold">{SHEET_LABEL}</h3>
        <span className="text-body text-muted-foreground">
          {s.found ? <>found as worksheet <b className="font-semibold text-foreground">“{s.sheet_name}”</b>, {s.counts.rows.toLocaleString("en-GB")} rows</> : "worksheet not found"}
        </span>
      </div>
      {s.blocked && !s.needs_override && (
        <div className="mb-3"><Note tone="red" role="alert" title="This sheet will not be applied">
          <ul className="list-disc pl-4">{s.block_reasons.map((b) => <li key={b}>{b}</li>)}</ul>
        </Note></div>
      )}
      {s.needs_override && (
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
          <div role="group" aria-label={`${SHEET_LABEL} rows by result`} className="mb-3 flex flex-wrap gap-2">
            {GROUPS.map((x) => <Chip key={x.g} label={x.label} icon={x.icon} n={s.counts[x.g]} pressed={group === x.g} onClick={() => chooseGroup(x.g)} />)}
          </div>
          {error && <p role="alert" className="text-body font-semibold text-red">{error}</p>}
          {data && (data.total === 0 ? <p className="text-body text-muted-foreground">No {g.label.toLowerCase()} rows.</p> : (
            <>
              <div className="tbox">
              <table className="tbl band table-fixed" aria-label={`${SHEET_LABEL}: ${g.label} rows`}>
                <thead><tr>
                  <th scope="col" className="num w-16">Row</th>
                  <th scope="col" className="w-[22%]">Site name</th>
                  <th scope="col" className="num w-24">Latitude</th>
                  <th scope="col" className="num w-24">Longitude</th>
                  <th scope="col">Status or reason</th>
                </tr></thead>
                <tbody>
                  {data.items.map((r) => {
                    return (
                      <tr key={r.id}>
                        <td className="num text-muted-foreground">{r.row_number ?? "—"}</td>
                        <th scope="row" className="truncate font-semibold" title={r.key || undefined}>{r.key || <i className="font-normal text-muted-foreground">blank</i>}</th>
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

// The footer under a sheet's preview: the override reason and the Apply button.
function SheetFooter({ upload, s }: { upload: SiteMasterUploadState; s: Sheet }) {
  // the red note already says it will not be applied
  if (!s.found || (s.blocked && !s.needs_override)) {
    return null;
  }
  const k = s.kind;
  const w = upload.why(s);
  return (
    <div className="mt-4 flex flex-wrap items-end gap-4 border-t pt-4">
      {upload.overriding(s) && (
        <label className="w-[420px]"><span className="lbl mb-1 block text-body! text-foreground!">Reason for the override (required)</span>
          <input className="field" value={upload.reason} onChange={(e) => upload.setReason(e.target.value)} />
        </label>
      )}
      <button type="button" className="btn btn-p" disabled={!!w} aria-describedby={`sm-${k}-why`} onClick={() => upload.setConfirming(s)}>Apply {SHEET_LABEL}…</button>
      <div id={`sm-${k}-why`} className="text-body text-muted-foreground">
        {w && <p>{w}</p>}
      </div>
    </div>
  );
}

export function SiteMasterUpload() {
  const upload = useSiteMasterUpload();
  const { staged, busy, error, override, result, addOnly, sheets } = upload;
  const { pick, apply, setConfirming } = upload;
  const c = upload.confirmingSheet;
  return (
    <div className="space-y-4">
    <section className="card" aria-labelledby="sm-h">
      <div className="card-h">
        <h2 id="sm-h">Site master workbook</h2>
      </div>
      <div className="space-y-4">
        <FilePick label="Upload a site master workbook" busy={busy} onFile={pick} />
        <div>
          <label className="flex w-fit items-center gap-2 text-body font-medium">
            <input type="checkbox" className="size-4" checked={addOnly} onChange={(e) => upload.setAddOnly(e.target.checked)} aria-describedby="sm-add-only-hint" />
            Add and update only
          </label>
          <p id="sm-add-only-hint" className="sr-only">Use for a hand-picked list. Sites that are not in the file stay active.</p>
        </div>
        {error && <Note tone="red" role="alert" title={error} />}
        <div aria-live="polite" data-testid="sm-result">
          {result && (
            <Note tone="green" title="Site master applied">
              <p><b className="font-semibold">{SHEET_LABEL}:</b> {resultLine(result.sheets.sites ?? {})}</p>
              {result.warnings.length > 0 && (
                <><p className="mt-2 font-semibold">Warnings</p><ul className="list-disc pl-4">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul></>
              )}
            </Note>
          )}
        </div>
      </div>
      <Files data={upload.uploads} />
    </section>
    {staged && (
      <section aria-labelledby="sm-prev-title" className="card" data-testid="sm-preview">
        <div className="card-h">
          <h2 id="sm-prev-title" className="truncate">Preview of {staged.filename}</h2>
        </div>
        <div className="space-y-6">
          {staged.add_only && <p className="text-body text-muted-foreground">Add and update only: sites not in this file are kept.</p>}
          {sheets.map((s) => (
            <SheetPanel key={`${staged.upload_id}-${s.kind}`} uploadId={staged.upload_id} s={s}
              override={override} onOverride={upload.setOverride}>
              <SheetFooter upload={upload} s={s} />
            </SheetPanel>
          ))}
          <div className="border-t pt-4">
            <button type="button" className="btn" onClick={upload.discard}>Discard preview</button>
          </div>
        </div>
      </section>
    )}
      {c && staged && (
        <Dialog title={`Apply ${SHEET_LABEL}?`} onClose={() => setConfirming(null)} wide>
          <p className="mt-3 text-body">Add {c.counts.added}, update {c.counts.changed}; {c.counts.missing} missing are set inactive unless a segment or reservation uses them (those stay active with a warning); {c.counts.problem} problem rows are not applied.{c.needs_override ? " Row-count block overridden." : ""}</p>
          <p className="mt-3 text-body text-muted-foreground">Changes are saved in one step with a history record per field. There is no undo.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setConfirming(null)}>Cancel</button>
            <button type="button" className="btn btn-p" onClick={() => apply(c)} autoFocus>Apply</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
