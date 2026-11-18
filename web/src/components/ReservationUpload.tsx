import { useCallback, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon, type IconName } from "@/components/Icon";
import { Changes, Dialog, FilePick, Note, PAGE_SIZE } from "@/components/upload-parts";
import { ConfirmDialog, GroupChips, PagedTable, PreviewCard, type GroupInfo } from "@/components/upload-preview";
import { usePagedRows } from "@/lib/usePagedRows";
import {
  useReservationUpload,
  winKey,
  type ImportState,
  type ReservationPreview,
} from "@/lib/useReservationUpload";
import { plural, when } from "@/lib/utils";

type Row = components["schemas"]["app__ingest__reservation_upload_router__RowOut"];
type Group = Row["group"];
type Warning = components["schemas"]["WarningOut"];

// A row's `data` is plain JSON in the API (its shape depends on the group), so it is written here.
type Change = { field: string; old: unknown; new: unknown; protected: boolean; note?: string; blocked?: string };
type Shown = {
  customer: string | null;
  segment: string;
  cores: number;
  count_only: number | null;
  planned_date: string | null;
  group_label: string | null;
  additional: boolean | null;
  ports: [string, string[]][] | null;
};
type RowData = {
  reservation?: Shown | null;
  key?: string;
  rows?: number[];
  fields?: Record<string, unknown>;
  changes?: Change[];
  measurements?: unknown[];
  matched_reservation_id?: number;
};
const rowData = (row: Row) => row.data as RowData;

const GROUP: Record<Group, { label: string; icon: IconName; cls: string; word: string }> = {
  new: { label: "New segments", icon: "ch", cls: "h-green", word: "New segment" },
  changed: { label: "Changed segments", icon: "co", cls: "h-blue", word: "Changed" },
  unchanged: { label: "Unchanged", icon: "av", cls: "h-ns", word: "Unchanged" },
  missing: { label: "Not in this file", icon: "ns", cls: "h-ns", word: "Not in file, untouched" },
  reservations: { label: "Reservations", icon: "ch", cls: "h-green", word: "Will import" },
  conflicts: { label: "Conflicts", icon: "fl", cls: "h-red", word: "Conflict, skipped" },
  already_imported: { label: "Already imported", icon: "ch", cls: "h-ns", word: "Already imported" },
  ignored: { label: "Ignored", icon: "ns", cls: "h-ns", word: "Ignored" },
  needs_review: { label: "Needs review", icon: "lo", cls: "h-amber", word: "Needs review" },
  rejected: { label: "Rejected", icon: "fl", cls: "h-red", word: "Rejected" },
};
const OTHER: Group[] = [
  "new", "changed", "unchanged", "missing", "conflicts", "already_imported", "ignored", "needs_review", "rejected",
];
const CHIPS: GroupInfo<Group>[] = OTHER.map((group) => ({ g: group, ...GROUP[group] }));
const SEGMENT_GROUPS: Group[] = ["new", "changed", "unchanged", "missing"];
const FIELD: Record<string, string> = { region: "Region", distance_km: "Distance (km)", survey_cores: "Verified cores" };

const TEXT: Record<string, string> = {
  "h-red": "font-semibold text-red",
  "h-amber": "font-semibold text-amber",
  "h-green": "text-green",
  "h-blue": "text-blue",
  "h-ns": "text-muted-foreground",
};

function Pill({ group }: { group: Group }) {
  const info = GROUP[group];
  return <span className={`inline-flex items-center gap-1.5 ${TEXT[info.cls]}`}><Icon name={info.icon} />{info.word}</span>;
}

const DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  return DATE.format(new Date(value));
}

// One end's labels, a range shown as "first … last".
function portRange(labels: string[]): string {
  if (labels.length > 1) {
    return `${labels[0]} … ${labels[labels.length - 1]}`;
  }
  return labels[0];
}

function formatPorts(ports: Shown["ports"]): string {
  if (!ports?.length) {
    return "—";
  }
  return ports.map(([, labels]) => portRange(labels)).join(" ↔ ");
}

function formatCores(shown: Shown): string {
  if (shown.count_only) {
    return `count only ${shown.count_only}`;
  }
  return plural(shown.cores, "core");
}

function useUploadRows(uploadId: number, firstGroup: Group) {
  const load = useCallback((group: Group, page: number) => {
    const path = { upload_id: uploadId };
    const query = { group, page, page_size: PAGE_SIZE };
    return api.get("/api/admin/uploads/{upload_id}/rows", { path, query });
  }, [uploadId]);
  return usePagedRows(load, firstGroup);
}

function ImportSwitch({ state, onClosed }: { state: ImportState | null; onClosed: (state: ImportState) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!state) {
    return null;
  }
  if (state.closed) {
    return (
      <p data-testid="import-switch" role="status" className="text-body">
        <span className="inline-flex items-center gap-1.5 font-semibold text-amber">
          <Icon name="lo" />Reservation import closed on {when(state.closed_at)} by {state.closed_by}: {state.reason}
        </span>
      </p>
    );
  }
  const openDialog = () => {
    setOpen(true);
    setReason("");
    setError(null);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) {
      setError("Enter a reason for closing the import.");
      return;
    }
    try {
      onClosed(await api.post("/api/admin/reservation-import/close", { body: { reason: reason.trim() } }));
      setOpen(false);
    } catch (caught) {
      setError(errorText(caught, "Could not close the import. Try again."));
    }
  };
  return (
    <div data-testid="import-switch" className="flex items-center gap-3 text-body">
      <span className="inline-flex items-center gap-1.5 font-semibold text-green"><Icon name="ch" />Import open</span>
      <button type="button" className="btn btn-sm ml-auto" onClick={openDialog}>Close reservation import…</button>
      {open && (
        <Dialog title="Close reservation import?" onClose={() => setOpen(false)}>
          <form onSubmit={submit} noValidate>
            <p className="mt-1 text-body text-muted-foreground">
              After closing, reservation rows in uploaded workbooks are ignored and new reservations are made only in
              the dashboard. This is one-time: there is no way to reopen it.
            </p>
            {error && (
              <p role="alert" className="mt-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">
                {error}
              </p>
            )}
            <label className="mt-4 block">
              <span className="lbl mb-1 block text-body! text-foreground!">Reason (required)</span>
              <textarea className="field h-20! py-2" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
                aria-invalid={!!error && !reason.trim()} />
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

function RowWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null;
  }
  const text = warnings.length === 1 ? warnings[0] : `${warnings.length} warnings`;
  return (
    <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-amber" title={warnings.join("; ")}>
      <Icon name="lo" />{text}
    </span>
  );
}

function ReservationLine({ row }: { row: Row }) {
  const shown = rowData(row).reservation!;
  const ports = formatPorts(shown.ports);
  return (
    <tr>
      <td className="num text-muted-foreground">{row.row_number}</td>
      <th scope="row" className="font-semibold">{shown.customer}</th>
      <td>{shown.segment}</td>
      <td className="num">{formatCores(shown)}</td>
      <td>{formatDate(shown.planned_date)}<RowWarnings warnings={row.warnings} /></td>
      <td>{shown.group_label ?? "—"}</td>
      <td>{shown.additional ? "Yes" : "No"}</td>
      <td className="max-w-[260px] truncate" title={ports}>{ports}</td>
    </tr>
  );
}

function Reservations({ uploadId, total }: { uploadId: number; total: number }) {
  const rows = useUploadRows(uploadId, "reservations");
  return (
    <section aria-labelledby="ru-res-h" data-testid="ru-reservations">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h3 id="ru-res-h" className="text-[15px] font-semibold">
          Reservations to import <span className="font-normal text-muted-foreground">({total.toLocaleString("en-GB")})</span>
        </h3>
      </div>
      <PagedTable rows={rows} empty="No reservation rows will be imported.">
        {(items) => (
          <table className="tbl band" aria-label="Reservations to import">
            <thead>
              <tr>
                <th className="num w-16">Row</th>
                <th>Customer</th>
                <th>Segment</th>
                <th className="num w-20">Cores</th>
                <th className="w-32">Planned date</th>
                <th>Group</th>
                <th className="w-28">Additional</th>
                <th>Ports</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => <ReservationLine key={row.id} row={row} />)}
            </tbody>
          </table>
        )}
      </PagedTable>
    </section>
  );
}

type WinProps = { wins: Set<string>; onWin: (key: string, on: boolean) => void };

function RowChanges({ row, changes, wins, onWin }: { row: Row; changes: Change[] } & WinProps) {
  const named = changes.map((change) => ({ ...change, field: FIELD[change.field] ?? change.field }));
  const excelBox = (i: number) => {
    const change = changes[i];
    if (!change.protected || change.blocked) {
      return null;
    }
    const key = winKey(row.id, change.field);
    return (
      <label className="ml-3 inline-flex items-center gap-1.5 font-medium">
        <input type="checkbox" className="size-4" checked={wins.has(key)} onChange={(e) => onWin(key, e.target.checked)} />
        Use Excel value
      </label>
    );
  };
  return <Changes changes={named} extra={excelBox} />;
}

function NewFields({ fields }: { fields: Record<string, unknown> }) {
  const text = Object.entries(fields).map(([name, value]) => `${FIELD[name] ?? name} ${value}`).join(" · ");
  return <p>{text || "No segment values in the file"}</p>;
}

function RowDetails({ row, group, segment, wins, onWin }: { row: Row; group: Group; segment: boolean } & WinProps) {
  const data = rowData(row);
  const reservation = data.reservation;
  const measured = data.measurements?.length ?? 0;
  const warnings = row.warnings.filter((warning) => warning !== row.reason);
  return (
    <td className="whitespace-normal!">
      {row.reason && <p>{row.reason}</p>}
      {reservation && !segment && (
        <p className="text-muted-foreground">
          {reservation.customer ?? "no customer"} · {reservation.segment} · {formatCores(reservation)}
        </p>
      )}
      {group === "new" && data.fields && <NewFields fields={data.fields} />}
      {data.changes && data.changes.length > 0 && (
        <RowChanges row={row} changes={data.changes} wins={wins} onWin={onWin} />
      )}
      {measured > 0 && (
        <p className="text-muted-foreground">{plural(measured, "new Measured loss", "new Measured losses")} appended</p>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="flex items-center gap-1.5 text-amber"><Icon name="lo" />{warning}</p>
      ))}
    </td>
  );
}

function GroupRowLine({ row, group, wins, onWin }: { row: Row; group: Group } & WinProps) {
  const segment = SEGMENT_GROUPS.includes(group);
  const data = rowData(row);
  return (
    <tr className="align-top [&>*]:py-2.5! [&>*]:h-auto!">
      {segment && (
        <>
          <th scope="row" className="font-semibold">{data.key}</th>
          <td className="text-muted-foreground">{data.rows?.join(", ") ?? "—"}</td>
        </>
      )}
      {!segment && (
        <>
          <td className="num text-muted-foreground">{row.row_number}</td>
          <td className="text-muted-foreground">{row.sheet_name}</td>
        </>
      )}
      <td><Pill group={group} /></td>
      <RowDetails row={row} group={group} segment={segment} wins={wins} onWin={onWin} />
    </tr>
  );
}

function firstGroup(counts: Record<string, number>): Group {
  const shown = OTHER.find((group) => group !== "missing" && group !== "unchanged" && counts[group] > 0);
  return shown ?? "unchanged";
}

function GroupRows({ uploadId, counts, wins, onWin }: { uploadId: number; counts: Record<string, number> } & WinProps) {
  const rows = useUploadRows(uploadId, firstGroup(counts));
  const group = rows.group;
  const segment = SEGMENT_GROUPS.includes(group);
  const label = GROUP[group].label;
  return (
    <section aria-labelledby="ru-rows-h" data-testid="ru-groups">
      <h3 id="ru-rows-h" className="mb-2 text-[15px] font-semibold">Rows by group</h3>
      <GroupChips label="Groups" groups={CHIPS} counts={counts} current={group} onChoose={rows.chooseGroup} />
      <PagedTable rows={rows} empty={`No rows in ${label}.`}>
        {(items) => (
          <table className="tbl band" aria-label={`${label} rows`}>
            <thead>
              <tr>
                {segment && <><th>Segment</th><th>File rows</th></>}
                {!segment && <><th className="num w-16">Row</th><th className="w-36">Sheet</th></>}
                <th className="w-36">Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => <GroupRowLine key={row.id} row={row} group={group} wins={wins} onWin={onWin} />)}
            </tbody>
          </table>
        )}
      </PagedTable>
    </section>
  );
}

// Warnings as one quiet list: the first 3, then "Show all".
function Warnings({ list }: { list: Warning[] }) {
  const [all, setAll] = useState(false);
  if (!list.length) {
    return null;
  }
  const shown = all ? list : list.slice(0, 3);
  return (
    <section aria-labelledby="ru-warn-h" className="text-body">
      <h3 id="ru-warn-h" className="inline-flex items-center gap-1.5 font-semibold text-amber">
        <Icon name="lo" />{plural(list.length, "warning")}
      </h3>
      <ul className="mt-1 list-disc space-y-0.5 pl-9" aria-label="Warnings">
        {shown.map((warning, i) => <li key={i} data-kind={warning.kind}>{warning.message}</li>)}
      </ul>
      {list.length > 3 && (
        <button type="button" className="mt-1 ml-5 font-semibold text-blue underline underline-offset-2"
          aria-expanded={all} onClick={() => setAll((current) => !current)}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </section>
  );
}

type Upload = ReturnType<typeof useReservationUpload>;
type Result = NonNullable<Upload["result"]>;

function ResultNote({ result }: { result: Result }) {
  const counts = result.counts;
  const ignored = result.ignored_reservation_rows;
  const ignoredText = ignored ? `, ${plural(ignored, "reservation row")} ignored (import closed)` : "";
  const moreWarnings = result.warnings.length - 20;
  return (
    <Note tone="green" title="Upload confirmed">
      <p>
        {plural(counts.reservations, "reservation")} imported, {plural(counts.segments, "new segment")},{" "}
        {plural(counts.segment_updates, "segment field")} updated, {plural(counts.cores, "core")},{" "}
        {plural(counts.ports, "port")} and {plural(counts.customers, "customer")} added,{" "}
        {plural(counts.measurements, "Measured loss", "Measured losses")} appended{ignoredText}.
      </p>
      {result.skipped.length > 0 && (
        <>
          <p className="mt-2 font-semibold">Skipped rows</p>
          <ul className="list-disc pl-4">
            {result.skipped.map((skipped) => <li key={skipped.row_number}>Row {skipped.row_number}: {skipped.reason}</li>)}
          </ul>
        </>
      )}
      {result.warnings.length > 0 && (
        <>
          <p className="mt-2 font-semibold">Warnings</p>
          <ul className="list-disc pl-4">
            {result.warnings.slice(0, 20).map((warning, i) => <li key={i}>{warning.message}</li>)}
          </ul>
          {moreWarnings > 0 && <p>and {moreWarnings} more.</p>}
        </>
      )}
    </Note>
  );
}

function notImportedCount(counts: Record<string, number>): number {
  return counts.already_imported + counts.ignored + counts.needs_review + counts.rejected;
}

function Preview({ upload, preview }: { upload: Upload; preview: ReservationPreview }) {
  const counts = preview.counts;
  const willImport = `${plural(counts.reservations, "reservation")} will be imported; `
    + `${plural(notImportedCount(counts), "row")} will not be imported.`;
  const closedText = "Reservation import is closed: reservation rows are ignored.";
  return (
    <PreviewCard titleId="ru-prev-h" testId="ru-preview" filename={preview.filename} roomy>
      <p className="-mt-2 text-body">{preview.switch_closed ? closedText : willImport}</p>
      <Warnings list={preview.warnings} />
      <Reservations uploadId={preview.upload_id} total={counts.reservations} />
      <GroupRows uploadId={preview.upload_id} counts={counts} wins={upload.wins} onWin={upload.setWin} />
      <div className="flex items-center gap-4 border-t pt-4">
        <button type="button" className="btn btn-p" onClick={() => upload.setConfirming(true)}>Confirm import…</button>
        <button type="button" className="btn" onClick={upload.discard}>Discard preview</button>
      </div>
    </PreviewCard>
  );
}

function winsText(wins: number): string {
  if (wins === 0) {
    return " (dashboard-edited fields keep the dashboard value)";
  }
  return ` (Excel value used for ${plural(wins, "dashboard-edited field")})`;
}

function ConfirmUpload({ upload, preview }: { upload: Upload; preview: ReservationPreview }) {
  const counts = preview.counts;
  return (
    <ConfirmDialog title="Confirm this upload?" confirmLabel="Confirm" wide onCancel={() => upload.setConfirming(false)}
      onConfirm={upload.confirm}>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-body">
        <li>Import <b>{plural(counts.reservations, "reservation")}</b> as approved.</li>
        <li>
          Add <b>{counts.new}</b> new segments; update <b>{counts.changed}</b> changed segments
          {winsText(upload.wins.size)}.
        </li>
        <li>
          Skip <b>{counts.conflicts}</b> conflicts; <b>{notImportedCount(counts)}</b> rows are not imported
          (already imported, ignored, needs review, rejected).
        </li>
        <li><b>{counts.missing}</b> segments not in this file stay as they are.</li>
      </ul>
      <p className="mt-3 text-body text-muted-foreground">
        Everything is saved in one step. Existing reservations are never changed.
      </p>
    </ConfirmDialog>
  );
}

export function ReservationUpload() {
  const upload = useReservationUpload();
  const { preview, result } = upload;
  return (
    <div className="space-y-4">
      <section className="card" aria-labelledby="ru-h">
        <div className="card-h">
          <h2 id="ru-h">Reservations (Excel)</h2>
        </div>
        <div className="space-y-4">
          <FilePick label="Upload a Reservation workbook" busy={upload.busy} onFile={upload.pick} />
          <ImportSwitch state={upload.importState} onClosed={upload.setImportState} />
          {upload.error && <Note tone="red" role="alert" title={upload.error} />}
          <div aria-live="polite" data-testid="ru-result">
            {result && <ResultNote result={result} />}
          </div>
        </div>
      </section>
      {preview && <Preview upload={upload} preview={preview} />}
      {upload.confirming && preview && <ConfirmUpload upload={upload} preview={preview} />}
    </div>
  );
}
