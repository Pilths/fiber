import { useState } from "react";
import { UploadRouteBox } from "@/components/UploadRouteBox";
import { useSegmentRoutes, type StoredRoute } from "@/lib/useSegmentRoutes";
import type { SegmentRow } from "@/lib/useSegmentList";

type Routes = ReturnType<typeof useSegmentRoutes>;

function Actions({ route, routes }: { route: StoredRoute; routes: Routes }) {
  const state = routes.states[route.id] ?? "active";
  if (state === "removing") {
    return (
      <span className="flex items-center justify-center gap-3">
        <span>Remove route?</span>
        <button type="button" className="btn btn-sm" onClick={() => routes.remove(route.id)}>Remove</button>
        <button type="button" className="link" onClick={() => routes.cancel(route.id)}>Cancel</button>
      </span>
    );
  }
  if (state === "removed") {
    return (
      <span className="flex items-center justify-center gap-3">
        <span className="font-semibold text-amber">removed</span>
        <button type="button" className="link" onClick={() => routes.undo(route.id)}>Undo</button>
      </span>
    );
  }
  return (
    <span className="flex items-center justify-center gap-4">
      <a className="link" href={`/api/admin/kmz/groups/${route.id}/kmz`} download aria-label={`Export ${route.name}`}>
        Export
      </a>
      <button type="button" className="link" aria-label={`Remove ${route.name}`} onClick={() => routes.ask(route.id)}>
        Remove
      </button>
    </span>
  );
}

function RouteRow({ route, routes }: { route: StoredRoute; routes: Routes }) {
  return (
    <tr data-testid={`kmz-route-${route.name}`}>
      <td>{route.folder || "-"}</td>
      <td title={route.name}>{route.name}</td>
      <td className="num">{route.distance_km.toFixed(1)} km</td>
      <td title={route.file}>{route.file}</td>
      <td className="num">{route.uploaded}</td>
      <td><Actions route={route} routes={routes} /></td>
    </tr>
  );
}

// The expanded segment row: the segment's stored KMZ routes and the per-segment upload.
export function KmzRoutesCard({ row, onChanged }: { row: SegmentRow; onChanged: () => void }) {
  const routes = useSegmentRoutes(row.id, onChanged);
  const [uploading, setUploading] = useState(false);
  const added = () => {
    setUploading(false);
    routes.load();
    onChanged();
  };
  return (
    <div className="grid w-full gap-4 rounded-lg border bg-white p-4" data-testid="kmz-routes-card">
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-semibold">KMZ routes</h3>
        <button type="button" className="btn btn-sm" onClick={() => setUploading(true)}>Upload KMZ route</button>
      </div>
      {routes.error && <p role="alert" className="text-body font-semibold text-red">{routes.error}</p>}
      {routes.routes.length === 0 && <p className="text-body">No route</p>}
      {routes.routes.length > 0 && (
        <table className="tbl" aria-label="KMZ routes">
          <colgroup>
            <col className="w-[160px]" /><col /><col className="w-[110px]" /><col className="w-[200px]" />
            <col className="w-[120px]" /><col className="w-[240px]" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Folder</th><th scope="col">Name</th><th scope="col">Distance</th>
              <th scope="col">File</th><th scope="col">Uploaded</th><th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>{routes.routes.map((route) => <RouteRow key={route.id} route={route} routes={routes} />)}</tbody>
        </table>
      )}
      {uploading && <UploadRouteBox row={row} onClose={() => setUploading(false)} onAdded={added} />}
    </div>
  );
}
