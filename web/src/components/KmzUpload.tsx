import { KmzFolderTree } from "@/components/KmzFolderTree";
import { KmzGroups } from "@/components/KmzGroups";
import { FilePick, Note } from "@/components/upload-parts";
import { PreviewCard } from "@/components/upload-preview";
import { useKmzUpload, type FixedTarget, type KmzStaged } from "@/lib/useKmzUpload";
import { formatKm, plural } from "@/lib/format";

type Staged = KmzStaged;
type Shaped = Staged["shaped"][number];
type Skipped = Staged["skipped"][number];

const KMZ = { accept: ".kmz,application/vnd.google-earth.kmz", button: "Choose .kmz file" };

type Upload = ReturnType<typeof useKmzUpload>;

function ShapedTable({ rows, ticked, onTick }: {
  rows: Shaped[]; ticked: Set<number>; onTick: (segmentId: number, checked: boolean) => void;
}) {
  return (
    <div className="tbox">
      <table className="tbl band table-fixed" aria-label="Segments to draw">
        <thead>
          <tr>
            <th scope="col" className="w-12"><span className="sr-only">Include</span></th>
            <th scope="col">Segment</th>
            <th scope="col" className="num w-32">Drawn (km)</th>
            <th scope="col" className="num w-32">Excel (km)</th>
            <th scope="col" className="w-48">Line on the map</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.segment_id ?? "title"}-${row.name}`}>
              <td>
                <input type="checkbox" checked={ticked.has(row.segment_id)} aria-label={`Include ${row.name}`}
                  onChange={(event) => onTick(row.segment_id, event.target.checked)} />
              </td>
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
            <tr key={`${row.segment_id ?? "title"}-${row.name}`}>
              <th scope="row" className="truncate font-semibold" title={row.name}>{row.name}</th>
              <td className="font-semibold text-amber">Needs review: {row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// "Apply 2 route lines and 3 folders"
function applyLabel(routes: number, folders: number): string {
  const parts = [];
  if (routes > 0) {
    parts.push(plural(routes, "route line"));
  }
  if (folders > 0) {
    parts.push(plural(folders, "folder"));
  }
  return ["Apply", parts.join(" and ")].join(" ").trim();
}

// With a fixed target the route lines are left out: only folders are attached.
function Preview({ staged, upload, fixed }: { staged: Staged; upload: Upload; fixed: boolean }) {
  const routes = fixed ? [] : staged.shaped;
  const skipped = fixed ? [] : staged.skipped;
  const nothing = routes.length === 0 && staged.groups.length === 0;
  return (
    <PreviewCard titleId="kmz-prev-title" testId="kmz-preview" filename={staged.filename} onDiscard={upload.discard}>
      <p className="text-body text-muted-foreground">
        {plural(staged.lines, "line")} in folder <b className="font-semibold text-foreground">“{staged.folder}”</b>.
      </p>
      {staged.block_reason ? (
        <Note tone="red" role="alert" title="This file will not be applied">{staged.block_reason}</Note>
      ) : (
        <>
          {routes.length > 0 && (
            <section className="space-y-2" aria-labelledby="kmz-routes-h">
              <h3 id="kmz-routes-h" className="font-semibold">Route lines</h3>
              <ShapedTable rows={routes} ticked={upload.routeIds} onTick={upload.toggleRoute} />
            </section>
          )}
          {skipped.length > 0 && <SkippedTable rows={skipped} />}
          {staged.groups.length > 0 && (
            <section className="space-y-2" aria-labelledby="kmz-groups-h">
              <h3 id="kmz-groups-h" className="font-semibold">Folders</h3>
              <KmzGroups groups={staged.groups} choices={upload.choices} lists={upload.lists}
                onChange={upload.changeChoice} fixed={fixed} />
            </section>
          )}
          {nothing && skipped.length === 0 && (
            <p className="text-body text-muted-foreground">
              {fixed ? "No folders" : "No line title matches a segment."}
            </p>
          )}
          {upload.error && <Note tone="red" role="alert" title={upload.error} />}
          <div className="flex flex-wrap items-center gap-4 border-t pt-4">
            <button type="button" className="btn btn-p" disabled={!upload.canApply || upload.busy}
              onClick={upload.apply}>
              {applyLabel(upload.routeCount, upload.groupCount)}
            </button>
          </div>
        </>
      )}
    </PreviewCard>
  );
}

function Result({ upload }: { upload: Upload }) {
  const result = upload.result;
  if (!result) {
    return null;
  }
  return (
    <Note tone="green" title="KMZ applied">
      <p>{plural(result.shaped, "segment line")} drawn on the map.</p>
      {result.groups_saved > 0 && <p>{plural(result.groups_saved, "folder")} saved.</p>}
      {result.clusters_created > 0 && <p>{plural(result.clusters_created, "cluster")} created.</p>}
      <button type="button" className="btn btn-sm mt-2" onClick={upload.reset}>Upload another</button>
    </Note>
  );
}

// `fixed` (Add from KMZ in an edit box): every folder goes to that segment or site; no target picker, no route lines.
export function KmzUpload({ fixed }: { fixed?: FixedTarget }) {
  const upload = useKmzUpload(fixed);
  return (
    <div className="space-y-4">
      <section className="card" aria-labelledby="kmz-h">
        <div className="card-h">
          <h2 id="kmz-h">KMZ</h2>
        </div>
        <div className="space-y-4">
          <FilePick label="Upload a KMZ file" busy={upload.busy} onFile={upload.pick} kind={KMZ} />
          {upload.folders.length > 0 && (
            <>
              <KmzFolderTree nodes={upload.folders} selected={upload.selected} onToggle={upload.toggle}
                onSelectAll={upload.selectAll} onSelectNone={upload.selectNone} />
              <button type="button" className="btn btn-p" disabled={!upload.canPreview} onClick={upload.preview}>
                Preview
              </button>
            </>
          )}
          {upload.error && !upload.staged && <Note tone="red" role="alert" title={upload.error} />}
          <div aria-live="polite" data-testid="kmz-result">
            <Result upload={upload} />
          </div>
        </div>
      </section>
      {upload.staged && <Preview staged={upload.staged} upload={upload} fixed={!!fixed} />}
    </div>
  );
}
