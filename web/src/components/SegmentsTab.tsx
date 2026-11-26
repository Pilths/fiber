import { ListPager } from "@/components/ListPager";
import { formatKm, plural } from "@/lib/format";
import type { useSegmentList, SegmentRow } from "@/lib/useSegmentList";
import type { SiteRow } from "@/lib/useSiteList";

type Props = {
  list: ReturnType<typeof useSegmentList>;
  sites: SiteRow[];
  onAdd: () => void;
  onEdit: (segmentId: number) => void;
};

const cell = (value: string | number | null | undefined) => (value == null || value === "" ? "-" : value);

function Row({ row, onEdit }: { row: SegmentRow; onEdit: (segmentId: number) => void }) {
  const name = `${row.site_a}-${row.site_b}`;
  return (
    <tr>
      <th scope="row" className="font-normal">{name}</th>
      <td>{row.route_type}</td>
      <td>{cell(row.route)}</td>
      <td>{cell(row.section)}</td>
      <td className="num">{row.distance_km == null ? "-" : `${formatKm(Number(row.distance_km))} km`}</td>
      <td className="num">{cell(row.survey_cores)}</td>
      <td className="num">{row.cable_size}</td>
      <td className="num">{row.kmz_route_count === 0 ? "-" : row.kmz_route_count}</td>
      <td>
        <button type="button" className="btn btn-sm" aria-label={`Edit segment ${name}`} onClick={() => onEdit(row.id)}>
          Edit
        </button>
      </td>
    </tr>
  );
}

export function SegmentsTab({ list, sites, onAdd, onEdit }: Props) {
  const { filters, change } = list;
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="flex items-center gap-6 px-4 py-3">
        <div className="flex items-center gap-2">
          <input className="field w-[280px]" type="search" placeholder="Search segment, site or route"
            aria-label="Search segments" value={filters.search} onChange={(event) => change({ search: event.target.value })} />
          <select className="field w-[200px]" aria-label="Site" value={filters.siteId ?? ""}
            onChange={(event) => change({ siteId: event.target.value === "" ? null : Number(event.target.value) })}>
            <option value="">All sites</option>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
          {filters.siteId != null && <button type="button" className="btn" onClick={onAdd}>Add segment</button>}
          <select className="field w-[140px]" aria-label="Route" value={filters.route}
            onChange={(event) => change({ route: event.target.value })}>
            <option value="">All routes</option>
            {list.routes.map((route) => <option key={route}>{route}</option>)}
          </select>
        </div>
        <span className="h-6 w-px bg-border" aria-hidden="true" />
        <div className="flex items-center gap-2">
          <button type="button" className="chip" aria-pressed={filters.noRoute}
            onClick={() => change({ noRoute: !filters.noRoute })}>No route only</button>
          <button type="button" className="chip" aria-pressed={filters.notRegistered}
            onClick={() => change({ notRegistered: !filters.notRegistered })}>Not registered only</button>
        </div>
        <span className="ml-auto font-semibold" data-testid="segment-count">{plural(list.total, "segment")}</span>
      </div>
      {list.error && <p role="alert" className="px-4 pb-3 text-body font-semibold text-red">{list.error}</p>}
      <table className="tbl border-t" aria-label="Segments">
        <colgroup>
          <col /><col className="w-[110px]" /><col className="w-[90px]" /><col className="w-[110px]" />
          <col className="w-[110px]" /><col className="w-[150px]" /><col className="w-[120px]" />
          <col className="w-[120px]" /><col className="w-[90px]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Segment</th><th scope="col">Type</th><th scope="col">Route</th><th scope="col">Cluster</th>
            <th scope="col">Distance</th><th scope="col">Registered cores</th><th scope="col">Total cores</th>
            <th scope="col">KMZ routes</th><th scope="col"><span className="sr-only">Edit</span></th>
          </tr>
        </thead>
        <tbody>{list.shown.map((row) => <Row key={row.id} row={row} onEdit={onEdit} />)}</tbody>
      </table>
      <ListPager total={list.total} page={list.page} onPage={list.setPage} />
    </div>
  );
}
