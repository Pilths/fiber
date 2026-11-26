import { ListPager } from "@/components/ListPager";
import { plural } from "@/lib/format";
import { KIND_LABEL, SITE_KINDS, type SiteRow, type useSiteList } from "@/lib/useSiteList";

type Props = {
  list: ReturnType<typeof useSiteList>;
  onEdit: (siteId: number) => void;
  onSegments: (siteId: number) => void;
};

const cell = (value: number | null) => (value == null ? "-" : value);

function Row({ row, onEdit, onSegments }: { row: SiteRow } & Pick<Props, "onEdit" | "onSegments">) {
  return (
    <tr>
      <th scope="row" className="font-normal">{row.name}</th>
      <td>{KIND_LABEL[row.kind] ?? row.kind}</td>
      <td className="num">{cell(row.lat)}</td>
      <td className="num">{cell(row.lon)}</td>
      <td className="num">
        <button type="button" className="link" aria-label={`Segments of ${row.name}`} onClick={() => onSegments(row.id)}>
          {row.segment_count}
        </button>
      </td>
      <td>
        <button type="button" className="btn btn-sm" aria-label={`Edit site ${row.name}`} onClick={() => onEdit(row.id)}>
          Edit
        </button>
      </td>
      <td aria-hidden="true" />
    </tr>
  );
}

export function SitesTab({ list, onEdit, onSegments }: Props) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="flex items-center gap-6 px-4 py-3">
        <div className="flex items-center gap-2">
          <input className="field w-[280px]" type="search" placeholder="Search sites" aria-label="Search sites"
            value={list.search} onChange={(event) => list.setSearch(event.target.value)} />
          <select className="field w-[160px]" aria-label="Type" value={list.kind}
            onChange={(event) => list.setKind(event.target.value)}>
            <option value="">All types</option>
            {SITE_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <span className="ml-auto font-semibold" data-testid="site-count">{plural(list.total, "site")}</span>
      </div>
      {list.error && <p role="alert" className="px-4 pb-3 text-body font-semibold text-red">{list.error}</p>}
      <table className="tbl border-t" aria-label="Sites">
        <colgroup>
          <col className="w-[260px]" /><col className="w-[130px]" /><col className="w-[130px]" />
          <col className="w-[130px]" /><col className="w-[120px]" /><col className="w-[90px]" /><col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Name</th><th scope="col">Type</th><th scope="col">Lat</th><th scope="col">Long</th>
            <th scope="col">Segments</th><th scope="col"><span className="sr-only">Edit</span></th>
            <th scope="col" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {list.shown.map((row) => <Row key={row.id} row={row} onEdit={onEdit} onSegments={onSegments} />)}
        </tbody>
      </table>
      <ListPager total={list.total} page={list.page} onPage={list.setPage} />
    </div>
  );
}
