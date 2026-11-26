import { RouteMap, type MapLine } from "@/components/RouteMap";
import { Dialog, FilePick, Note } from "@/components/upload-parts";
import { plural } from "@/lib/format";
import type { SegmentRow } from "@/lib/useSegmentList";
import { useUploadRoute, type LineStatus } from "@/lib/useUploadRoute";

const KMZ = { accept: ".kmz,application/vnd.google-earth.kmz", button: "Choose .kmz file" };
const STATUS_CLASS: Record<LineStatus["status"], string> = {
  same: "text-muted-foreground",
  "replaces route": "font-semibold text-amber",
  new: "font-semibold text-green",
};

type Staged = NonNullable<ReturnType<typeof useUploadRoute>["staged"]>;

function LineRows({ staged, statuses, state }: {
  staged: Staged; statuses: LineStatus[]; state: ReturnType<typeof useUploadRoute>;
}) {
  const byKey = new Map(staged.route_lines.map((line) => [line.key, line]));
  return (
    <table className="tbl" aria-label="Lines in the file">
      <colgroup><col className="w-[40px]" /><col /><col className="w-[110px]" /><col className="w-[90px]" /><col className="w-[130px]" /></colgroup>
      <thead>
        <tr>
          <th scope="col"><span className="sr-only">Add</span></th><th scope="col">Name</th><th scope="col">Folder</th>
          <th scope="col">Distance</th><th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {statuses.map((status) => {
          const line = byKey.get(status.key);
          const name = line?.name ?? status.key;
          return (
            <tr key={status.key} data-testid={`route-line-${name}`}>
              <td className="px-0">
                <input type="checkbox" aria-label={`Add ${name}`} checked={state.ticked.has(status.key)}
                  onChange={(event) => state.toggle(status.key, event.target.checked)} />
              </td>
              <td title={name}>{name}</td>
              <td title={line?.folder_path}>{line?.folder_path || "-"}</td>
              <td className="num">{status.distance_km.toFixed(1)} km</td>
              <td className={STATUS_CLASS[status.status]}>{status.status}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// "Upload KMZ route" for one segment (the expanded row's card).
export function UploadRouteBox({ row, onClose, onAdded }: { row: SegmentRow; onClose: () => void; onAdded: () => void }) {
  const state = useUploadRoute(row.id, [row.site_a_id, row.site_b_id]);
  const { staged, found } = state;
  const name = `${row.site_a}-${row.site_b}`;
  const fresh: MapLine[] = [];
  for (const line of staged?.route_lines ?? []) {
    if (state.ticked.has(line.key)) {
      fresh.push({ key: line.key, coords: line.coords });
    }
  }
  const add = async () => {
    if (await state.add()) {
      onAdded();
    }
  };
  return (
    <Dialog title="Upload KMZ route" onClose={onClose} cls="m-auto w-[1000px] max-w-[calc(100vw-32px)]">
      <div className="mt-4 grid grid-cols-[1fr_360px] gap-6">
        <div className="grid min-w-0 content-start gap-4">
          <p className="font-semibold">{name}</p>
          <FilePick label="Upload a KMZ route file" busy={state.busy} onFile={state.pick} kind={KMZ} />
          {state.fileName && <p className="text-body">{state.fileName}</p>}
          {staged && found && found.lines.length === 0 && <p className="text-body">No lines</p>}
          {staged && found && found.lines.length > 0 && <LineRows staged={staged} statuses={found.lines} state={state} />}
          {state.error && <Note tone="red" role="alert" title={state.error} />}
        </div>
        <RouteMap sites={state.sites} stored={found?.stored ?? []} fresh={fresh} />
      </div>
      <div className="mt-6 flex items-center justify-end gap-3 border-t pt-4">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-p" disabled={state.busy || state.ticked.size === 0} onClick={add}>
          Add {plural(state.ticked.size, "route")}
        </button>
      </div>
    </Dialog>
  );
}
