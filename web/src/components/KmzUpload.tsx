import { KmzFolderTree } from "@/components/KmzFolderTree";
import { Dialog, FilePick, Note } from "@/components/upload-parts";
import { useKmzUpload, type KmzStaged } from "@/lib/useKmzUpload";

type Staged = KmzStaged;
type Shaped = Staged["shaped"][number];
type Skipped = Staged["skipped"][number];

const KMZ = { accept: ".kmz,application/vnd.google-earth.kmz", button: "Choose .kmz file" };

function formatKm(km: number | null | undefined): string {
  if (km == null) {
    return "—";
  }
  return km.toFixed(2);
}

function ShapedTable({ rows }: { rows: Shaped[] }) {
  return (
    <div className="tbox">
      <table className="tbl band table-fixed" aria-label="Segments to draw">
        <thead>
          <tr>
            <th scope="col">Segment</th>
            <th scope="col" className="num w-32">Drawn (km)</th>
            <th scope="col" className="num w-32">Excel (km)</th>
            <th scope="col" className="w-48">Line on the map</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.segment_id}>
              <th scope="row" className="truncate font-semibold" title={row.name}>{row.name}</th>
              <td className="num">{formatKm(row.km)}</td>
              <td className="num">{formatKm(row.excel_km)}</td>
              <td>{row.had_shape ? "Replaces current line" : "New"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SkippedTable({ rows }: { rows: Skipped[] }) {
  return (
    <div className="tbox">
      <table className="tbl band table-fixed" aria-label="Segments not drawn">
        <thead>
          <tr>
            <th scope="col">Segment</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.segment_id}>
              <th scope="row" className="truncate font-semibold" title={row.name}>{row.name}</th>
              <td className="font-semibold text-amber">Needs review: {row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Preview({ staged, onApply, onDiscard }: { staged: Staged; onApply: () => void; onDiscard: () => void }) {
  const nothing = staged.shaped.length === 0;
  const sites = staged.sites_attached.join(", ") || "none";
  return (
    <section aria-labelledby="kmz-prev-title" className="card" data-testid="kmz-preview">
      <div className="card-h">
        <h2 id="kmz-prev-title" className="truncate">Preview of {staged.filename}</h2>
      </div>
      <div className="space-y-4">
        <p className="text-body text-muted-foreground">
          {staged.lines} {staged.lines === 1 ? "line" : "lines"} in folder <b className="font-semibold text-foreground">“{staged.folder}”</b>.
          Sites near the lines: <b className="font-semibold text-foreground">{sites}</b>
        </p>
        {staged.block_reason ? (
          <Note tone="red" role="alert" title="This file will not be applied">{staged.block_reason}</Note>
        ) : (
          <>
            {staged.shaped.length > 0 && <ShapedTable rows={staged.shaped} />}
            {staged.skipped.length > 0 && <SkippedTable rows={staged.skipped} />}
            {nothing && staged.skipped.length === 0 && (
              <p className="text-body text-muted-foreground">No segment has both its sites near these lines.</p>
            )}
            <div className="flex flex-wrap items-center gap-4 border-t pt-4">
              <button type="button" className="btn btn-p" disabled={nothing} onClick={onApply}>Apply KMZ…</button>
            </div>
          </>
        )}
        <div className="border-t pt-4">
          <button type="button" className="btn" onClick={onDiscard}>Discard preview</button>
        </div>
      </div>
    </section>
  );
}

function ConfirmApply({ staged, onCancel, onApply }: { staged: Staged; onCancel: () => void; onApply: () => void }) {
  const total = staged.shaped.length;
  const replacing = staged.shaped.filter((row) => row.had_shape).length;
  return (
    <Dialog title="Apply KMZ?" onClose={onCancel}>
      <p className="mt-3 text-body">
        {total} segment lines drawn on the map, {replacing} of them replace the current line.
        {staged.skipped.length > 0 && ` ${staged.skipped.length} need review and are skipped.`}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-p" onClick={onApply} autoFocus>Apply</button>
      </div>
    </Dialog>
  );
}

export function KmzUpload() {
  const upload = useKmzUpload();
  return (
    <div className="space-y-4">
      <section className="card" aria-labelledby="kmz-h">
        <div className="card-h">
          <h2 id="kmz-h">Route lines (KMZ)</h2>
        </div>
        <div className="space-y-4">
          <FilePick label="Upload a KMZ file" busy={upload.busy} onFile={upload.pick} kind={KMZ} />
          {upload.folders.length > 0 && (
            <>
              <KmzFolderTree nodes={upload.folders} selected={upload.selected} onToggle={upload.toggle} />
              <button type="button" className="btn btn-p" disabled={!upload.canPreview} onClick={upload.preview}>
                Preview
              </button>
            </>
          )}
          {upload.error && <Note tone="red" role="alert" title={upload.error} />}
          <div aria-live="polite" data-testid="kmz-result">
            {upload.result && (
              <Note tone="green" title="KMZ applied">
                <p>{upload.result.shaped} segment lines drawn on the map.</p>
              </Note>
            )}
          </div>
        </div>
      </section>
      {upload.staged && (
        <Preview staged={upload.staged} onApply={() => upload.setConfirming(true)} onDiscard={upload.discard} />
      )}
      {upload.confirming && upload.staged && (
        <ConfirmApply staged={upload.staged} onCancel={() => upload.setConfirming(false)} onApply={upload.apply} />
      )}
    </div>
  );
}
