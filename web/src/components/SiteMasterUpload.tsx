import { useCallback } from "react";
import { api } from "@/api/client";
import { Icon } from "@/components/Icon";
import { Changes, FilePick, Note, PAGE_SIZE, type Change } from "@/components/upload-parts";
import {
  ConfirmDialog,
  GroupChips,
  PagedTable,
  PreviewCard,
  StatusCell,
  type GroupInfo,
} from "@/components/upload-preview";
import { usePagedRows } from "@/lib/usePagedRows";
import {
  useSiteMasterUpload,
  type FileInfo,
  type Group,
  type Row,
  type Sheet,
  type SiteMasterUploadState,
  type Uploads,
} from "@/lib/useSiteMasterUpload";
import { formatDateTime } from "@/lib/format";
import { cell, field } from "@/lib/utils";

const SHEET_LABEL = "Site Location";
const GROUPS: GroupInfo<Group>[] = [
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

// An upload from before 16 Nov 2026 may also list a "dcs" sheet, which is not shown.
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

function FileLine({ file, isCurrent }: { file: FileInfo; isCurrent: boolean }) {
  const uploaded = `${formatDateTime(file.uploaded_at)} · ${file.uploaded_by}`;
  return (
    <tr data-testid={isCurrent ? "sm-current" : undefined}>
      <td className={`truncate ${isCurrent ? "font-semibold" : ""}`} title={file.filename}>{file.filename}</td>
      <td className="truncate" title={uploaded}>{uploaded}</td>
      <td><FileStatus file={file} isCurrent={isCurrent} /></td>
      <td className="num">{sheetRows(file)}</td>
      <td aria-hidden />
    </tr>
  );
}

// Current file and previous uploads in one compact table, current first.
function Files({ data }: { data: Uploads | null }) {
  if (!data) {
    return <p className="text-body text-muted-foreground">Loading…</p>;
  }
  const current = data.current;
  const list = [...(current ? [current] : []), ...data.previous.slice(0, 5)];
  return (
    <section aria-labelledby="sm-files-h" className="mt-5">
      <h3 id="sm-files-h" className="lbl mb-1.5">Uploads</h3>
      {!current && <p className="mb-2 text-body text-muted-foreground">No site master file applied yet.</p>}
      {list.length > 0 && (
        <div className="tbox">
          <table className="tbl band table-fixed [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead><tr><th className="w-[320px]">File</th><th className="w-[260px]">Uploaded</th><th className="w-[120px]">Status</th><th className="num w-[90px]">Sites</th><th aria-hidden /></tr></thead>
            <tbody>
              {list.map((file) => <FileLine key={file.upload_id} file={file} isCurrent={file === current} />)}
            </tbody>
          </table>
        </div>
      )}
      {data.previous.length > 5 && <p className="mt-1.5 text-xs text-muted-foreground">Showing the latest 5 of {data.previous.length} previous uploads.</p>}
    </section>
  );
}

function MissingNote({ inUse }: { inUse: boolean | null }) {
  if (inUse) {
    return <span className="inline-flex items-center gap-1.5 font-semibold text-amber"><Icon name="lo" />in use, stays active</span>;
  }
  return <span className="text-body text-muted-foreground">will be set inactive (never deleted)</span>;
}

function RowDetail({ row, group }: { row: Row; group: Group }) {
  const empty = !row.reason && group !== "changed" && group !== "missing";
  if (empty) {
    return null;
  }
  // The API sends each change as a plain object; its shape is the Changes list's.
  const changes = row.changes as Change[];
  return (
    <div className="space-y-1">
      {row.reason && <p className="text-body">{row.reason}</p>}
      {group === "changed" && <Changes changes={changes} />}
      {group === "missing" && <MissingNote inUse={row.in_use} />}
    </div>
  );
}

function RowLine({ row, info }: { row: Row; info: GroupInfo<Group> }) {
  const blank = <i className="font-normal text-muted-foreground">blank</i>;
  return (
    <tr>
      <td className="num text-muted-foreground">{row.row_number ?? "—"}</td>
      <th scope="row" className="truncate font-semibold" title={row.key || undefined}>{row.key || blank}</th>
      <td className="num truncate">{cell(row.parsed?.lat, field(row.raw, /^lat/i))}</td>
      <td className="num truncate">{cell(row.parsed?.lon, field(row.raw, /^lon/i))}</td>
      <StatusCell info={info}>
        <RowDetail row={row} group={info.g} />
      </StatusCell>
    </tr>
  );
}

// The chips and rows of a found sheet.
function SheetRows({ uploadId, sheet }: { uploadId: number; sheet: Sheet }) {
  const load = useCallback((group: Group, page: number) => {
    const path = { upload_id: uploadId };
    const query = { sheet: sheet.kind, group, page, page_size: PAGE_SIZE };
    return api.get("/api/admin/site-master/uploads/{upload_id}/rows", { path, query });
  }, [uploadId, sheet.kind]);
  const first = GROUPS.find((info) => sheet.counts[info.g] > 0)?.g ?? "added";
  const rows = usePagedRows(load, first);
  const info = GROUPS.find((candidate) => candidate.g === rows.group)!;
  return (
    <>
      <GroupChips label={`${SHEET_LABEL} rows by result`} groups={GROUPS} counts={sheet.counts}
        current={rows.group} onChoose={rows.chooseGroup} />
      <PagedTable rows={rows} empty={`No ${info.label.toLowerCase()} rows.`}>
        {(items) => (
          <table className="tbl band table-fixed" aria-label={`${SHEET_LABEL}: ${info.label} rows`}>
            <thead>
              <tr>
                <th scope="col" className="num w-16">Row</th>
                <th scope="col" className="w-[22%]">Site name</th>
                <th scope="col" className="num w-24">Latitude</th>
                <th scope="col" className="num w-24">Longitude</th>
                <th scope="col">Status or reason</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => <RowLine key={row.id} row={row} info={info} />)}
            </tbody>
          </table>
        )}
      </PagedTable>
    </>
  );
}

function BlockReasons({ sheet }: { sheet: Sheet }) {
  return <ul className="list-disc pl-4">{sheet.block_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>;
}

function OverrideNote({ sheet, override, onOverride }: {
  sheet: Sheet;
  override: boolean;
  onOverride: (on: boolean) => void;
}) {
  const title = override
    ? "Override chosen: this sheet will be applied"
    : "Blocked: this sheet will not be applied unless you override";
  return (
    <div className="mb-3">
      <Note tone="amber" title={title}>
        <BlockReasons sheet={sheet} />
        <label className="mt-2 flex items-center gap-2 font-medium">
          <input type="checkbox" className="size-4" checked={override} onChange={(e) => onOverride(e.target.checked)} />
          Override: the file really has fewer rows; apply this sheet anyway
        </label>
      </Note>
    </div>
  );
}

function SheetPanel({ uploadId, sheet, override, onOverride, children }: {
  uploadId: number;
  sheet: Sheet;
  override: boolean;
  onOverride: (on: boolean) => void;
  children?: React.ReactNode;
}) {
  const headingId = `sm-${sheet.kind}-h`;
  const sheetName = <b className="font-semibold text-foreground">“{sheet.sheet_name}”</b>;
  const rowCount = sheet.counts.rows.toLocaleString("en-GB");
  return (
    <section aria-labelledby={headingId} data-testid={`sheet-${sheet.kind}`}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h3 id={headingId} className="text-[15px] font-semibold">{SHEET_LABEL}</h3>
        <span className="text-body text-muted-foreground">
          {sheet.found && <>found as worksheet {sheetName}, {rowCount} rows</>}
          {!sheet.found && "worksheet not found"}
        </span>
      </div>
      {sheet.blocked && !sheet.needs_override && (
        <div className="mb-3">
          <Note tone="red" role="alert" title="This sheet will not be applied">
            <BlockReasons sheet={sheet} />
          </Note>
        </div>
      )}
      {sheet.needs_override && <OverrideNote sheet={sheet} override={override} onOverride={onOverride} />}
      {sheet.found && <SheetRows uploadId={uploadId} sheet={sheet} />}
      {children}
    </section>
  );
}

// The footer under a sheet's preview: the override remarks and the Apply button.
function SheetFooter({ upload, sheet }: { upload: SiteMasterUploadState; sheet: Sheet }) {
  // the red note already says it will not be applied
  if (!sheet.found || (sheet.blocked && !sheet.needs_override)) {
    return null;
  }
  const whyId = `sm-${sheet.kind}-why`;
  const why = upload.why(sheet);
  return (
    <div className="mt-4 flex flex-wrap items-end gap-4 border-t pt-4">
      {upload.overriding(sheet) && (
        <label className="w-[420px]"><span className="lbl mb-1 block text-body! text-foreground!">Remarks (optional)</span>
          <input className="field" value={upload.remarks} onChange={(e) => upload.setRemarks(e.target.value)} />
        </label>
      )}
      <button type="button" className="btn btn-p" disabled={!!why} aria-describedby={whyId}
        onClick={() => upload.setConfirming(sheet)}>
        Apply {SHEET_LABEL}…
      </button>
      <div id={whyId} className="text-body text-muted-foreground">
        {why && <p>{why}</p>}
      </div>
    </div>
  );
}

export function SiteMasterUpload() {
  const upload = useSiteMasterUpload();
  const { staged, result, sheets } = upload;
  const confirming = upload.confirmingSheet;
  return (
    <div className="space-y-4">
      <section className="card" aria-labelledby="sm-h">
        <div className="card-h">
          <h2 id="sm-h">Sites (Excel)</h2>
        </div>
        <div className="space-y-4">
          <FilePick label="Upload a site master workbook" busy={upload.busy} onFile={upload.pick} />
          <div>
            <label className="flex w-fit items-center gap-2 text-body font-medium">
              <input type="checkbox" className="size-4" checked={upload.addOnly}
                onChange={(e) => upload.setAddOnly(e.target.checked)} aria-describedby="sm-add-only-hint" />
              Add and update only
            </label>
            <p id="sm-add-only-hint" className="sr-only">Use for a hand-picked list. Sites that are not in the file stay active.</p>
          </div>
          {upload.error && <Note tone="red" role="alert" title={upload.error} />}
          <div aria-live="polite" data-testid="sm-result">
            {result && (
              <Note tone="green" title="Site master applied">
                <p><b className="font-semibold">{SHEET_LABEL}:</b> {resultLine(result.sheets.sites ?? {})}</p>
                {result.warnings.length > 0 && (
                  <>
                    <p className="mt-2 font-semibold">Warnings</p>
                    <ul className="list-disc pl-4">
                      {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  </>
                )}
              </Note>
            )}
          </div>
        </div>
        <Files data={upload.uploads} />
      </section>
      {staged && (
        <PreviewCard titleId="sm-prev-title" testId="sm-preview" filename={staged.filename} roomy
          onDiscard={upload.discard}>
          {staged.add_only && (
            <p className="text-body text-muted-foreground">Add and update only: sites not in this file are kept.</p>
          )}
          {sheets.map((sheet) => (
            <SheetPanel key={`${staged.upload_id}-${sheet.kind}`} uploadId={staged.upload_id} sheet={sheet}
              override={upload.override} onOverride={upload.setOverride}>
              <SheetFooter upload={upload} sheet={sheet} />
            </SheetPanel>
          ))}
        </PreviewCard>
      )}
      {confirming && staged && (
        <ConfirmDialog title={`Apply ${SHEET_LABEL}?`} wide onCancel={() => upload.setConfirming(null)}
          onConfirm={() => upload.apply(confirming)}>
          <p className="mt-3 text-body">
            Add {confirming.counts.added}, update {confirming.counts.changed}; {confirming.counts.missing} missing
            are set inactive unless a segment or reservation uses them (those stay active with a warning);{" "}
            {confirming.counts.problem} problem rows are not applied.
            {confirming.needs_override ? " Row-count block overridden." : ""}
          </p>
          <p className="mt-3 text-body text-muted-foreground">
            Changes are saved in one step with a history record per field. There is no undo.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
