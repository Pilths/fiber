import { useCallback } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";
import { Changes, FilePick, Note, PAGE_SIZE } from "@/components/upload-parts";
import {
  ConfirmDialog,
  GroupChips,
  PagedTable,
  PreviewCard,
  StatusCell,
  type GroupInfo,
} from "@/components/upload-preview";
import { usePagedRows } from "@/lib/usePagedRows";
import { useSegmentListUpload, type SegmentListStaged } from "@/lib/useSegmentListUpload";
import { cell, field } from "@/lib/utils";

type Row = components["schemas"]["app__ingest__segment_list_router__RowsOut"]["items"][number];
type Group = Row["group"];

const GROUPS: GroupInfo<Group>[] = [
  { g: "new", label: "New", icon: "ch", cls: "h-green" },
  { g: "changed", label: "Changed", icon: "co", cls: "h-blue" },
  { g: "unchanged", label: "Unchanged", icon: "av", cls: "h-ns" },
  { g: "problem", label: "Problem", icon: "lo", cls: "h-amber" },
];
const FIELD: Record<Row["changes"][number]["field"], string> = {
  distance_km: "Distance (km)",
  route: "Route",
  section: "Section",
  survey_cores: "Verified cores",
  cable_size: "Total cores",
};

function TextCell({ value, className = "" }: { value: string; className?: string }) {
  const title = value === "—" ? undefined : value;
  return <td className={`truncate ${className}`} title={title}>{value}</td>;
}

function RowLine({ row, info }: { row: Row; info: GroupInfo<Group> }) {
  const link = cell(row.parsed.link, field(row.raw, /^links?$/i));
  const distance = cell(row.parsed.distance_km, field(row.raw, /^(distance|km)/i));
  const verified = cell(row.parsed.verified_cores, field(row.raw, /^(verified|surveyed)\s*cores?$/i));
  const total = cell(row.parsed.total_cores, field(row.raw, /^total\s*cores?$/i));
  const changes = row.changes.map((change) => ({
    ...change,
    field: FIELD[change.field],
    note: "kept: edited in dashboard",
    blocked: change.blocked ?? undefined,
  }));
  return (
    <tr>
      <td className="num text-muted-foreground">{row.row_number}</td>
      <th scope="row" className="truncate font-semibold" title={link === "—" ? undefined : link}>{link}</th>
      <TextCell value={distance} className="num" />
      <TextCell value={cell(row.parsed.route, null)} />
      <TextCell value={cell(row.parsed.section, null)} />
      <TextCell value={verified} className="num" />
      <TextCell value={total} className="num" />
      <StatusCell info={info}>
        {row.reason && <p className="text-body">{row.reason}</p>}
        {info.g === "changed" && <Changes changes={changes} />}
      </StatusCell>
    </tr>
  );
}

function Rows({ staged }: { staged: SegmentListStaged }) {
  const uploadId = staged.upload_id;
  const load = useCallback((group: Group, page: number) => {
    const path = { upload_id: uploadId };
    const query = { group, page, page_size: PAGE_SIZE };
    return api.get("/api/admin/segment-list/uploads/{upload_id}/rows", { path, query });
  }, [uploadId]);
  const first = GROUPS.find((info) => staged.counts[info.g] > 0)?.g ?? "new";
  const rows = usePagedRows(load, first);
  const info = GROUPS.find((candidate) => candidate.g === rows.group)!;
  return (
    <>
      <GroupChips label="Segment list rows by result" groups={GROUPS} counts={staged.counts}
        current={rows.group} onChoose={rows.chooseGroup} />
      <PagedTable rows={rows} empty={`No ${info.label.toLowerCase()} rows.`}>
        {(items) => (
          <table className="tbl band table-fixed" aria-label={`Segment list: ${info.label} rows`}>
            <thead>
              <tr>
                <th scope="col" className="num w-16">Row</th>
                <th scope="col" className="w-[15%]">Link</th>
                <th scope="col" className="num w-28">Distance (km)</th>
                <th scope="col" className="w-[8%]">Route</th>
                <th scope="col" className="w-[8%]">Section</th>
                <th scope="col" className="num w-28">Verified cores</th>
                <th scope="col" className="num w-24">Total cores</th>
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

function Preview({ staged, onApply, onDiscard }: {
  staged: SegmentListStaged;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const counts = staged.counts;
  const blocked = !staged.found || staged.block_reason;
  const nothing = counts.new + counts.changed === 0;
  const sheetName = <b className="font-semibold text-foreground">“{staged.sheet_name}”</b>;
  const rowCount = counts.rows.toLocaleString("en-GB");
  return (
    <PreviewCard titleId="sl-prev-title" testId="sl-preview" filename={staged.filename} onDiscard={onDiscard}>
      <p className="text-body text-muted-foreground">
        {staged.found && <>Found as worksheet {sheetName}, {rowCount} rows</>}
        {!staged.found && "Worksheet not found"}
      </p>
      {blocked && (
        <Note tone="red" role="alert" title="This file will not be applied">
          {staged.block_reason ?? "No worksheet has the expected headers."}
        </Note>
      )}
      {!blocked && (
        <>
          <Rows key={staged.upload_id} staged={staged} />
          <div className="flex flex-wrap items-center gap-4 border-t pt-4">
            <button type="button" className="btn btn-p" disabled={nothing}
              aria-describedby={nothing ? "sl-why" : undefined} onClick={onApply}>
              Apply segment list…
            </button>
            {nothing && <p id="sl-why" className="text-body text-muted-foreground">Nothing new or changed to apply.</p>}
          </div>
        </>
      )}
    </PreviewCard>
  );
}

export function SegmentListUpload() {
  const upload = useSegmentListUpload();
  const { staged, result } = upload;
  return (
    <div className="space-y-4">
      <section className="card" aria-labelledby="sl-h">
        <div className="card-h">
          <h2 id="sl-h">Segments (Excel)</h2>
        </div>
        <div className="space-y-4">
          <FilePick label="Upload a segment list" busy={upload.busy} onFile={upload.pick} />
          {upload.error && <Note tone="red" role="alert" title={upload.error} />}
          <div aria-live="polite" data-testid="sl-result">
            {result && (
              <Note tone="green" title="Segment list applied">
                <p>
                  {result.created} created, {result.changed} changed,{" "}
                  {result.protected_kept} dashboard edits kept, {result.skipped} skipped.
                </p>
                {result.blocked > 0 && (
                  <>
                    <p className="mt-2 font-semibold">Not applied</p>
                    <ul className="list-disc pl-4">
                      {result.blocked_changes.map((change) => <li key={change}>{change}</li>)}
                    </ul>
                  </>
                )}
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
      </section>
      {staged && (
        <Preview staged={staged} onApply={() => upload.setConfirming(true)} onDiscard={upload.discard} />
      )}
      {upload.confirming && staged && (
        <ConfirmDialog title="Apply segment list?" onCancel={() => upload.setConfirming(false)}
          onConfirm={upload.apply}>
          <p className="mt-3 text-body">
            {staged.counts.new} new, {staged.counts.changed} changed, {staged.counts.problem} need review
            and are skipped. Fields edited in the dashboard are kept.
          </p>
          <p className="mt-3 text-body text-muted-foreground">
            Changes are saved in one step with a history record per field. There is no undo.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
