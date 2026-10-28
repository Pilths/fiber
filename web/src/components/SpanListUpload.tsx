import { useEffect, useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon, type IconName } from "@/components/Icon";
import { Changes, Chip, Dialog, FilePick, Note, PAGE_SIZE, Pager } from "@/components/upload-parts";
import { cell, field, uploadError } from "@/lib/utils";

type Staged = components["schemas"]["app__ingest__span_list_router__UploadOut"];
type Applied = components["schemas"]["app__ingest__span_list_router__ApplyOut"];
type Row = components["schemas"]["app__ingest__span_list_router__RowsOut"]["items"][number];
type Group = Row["group"];

const GROUPS: { g: Group; label: string; icon: IconName; cls: string }[] = [
  { g: "new", label: "New", icon: "ch", cls: "h-green" },
  { g: "changed", label: "Changed", icon: "co", cls: "h-blue" },
  { g: "unchanged", label: "Unchanged", icon: "av", cls: "h-ns" },
  { g: "problem", label: "Problem", icon: "lo", cls: "h-amber" },
];
const FIELD: Record<Row["changes"][number]["field"], string> = { distance_km: "Distance (km)", route_type: "Type", route: "Route", section: "Section" };

function Rows({ staged }: { staged: Staged }) {
  const [group, setGroup] = useState<Group>(GROUPS.find((x) => staged.counts[x.g] > 0)?.g ?? "new");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    api.get("/api/admin/span-list/uploads/{upload_id}/rows", { path: { upload_id: staged.upload_id }, query: { group, page, page_size: PAGE_SIZE } })
      .then((d) => { if (!stale) { setData(d); setError(null); } })
      .catch((e) => !stale && setError(errorText(e, "Could not load rows.")));
    return () => { stale = true; };
  }, [staged.upload_id, group, page]);
  const g = GROUPS.find((x) => x.g === group)!;
  return (
    <>
      <div role="group" aria-label="Span list rows by result" className="mb-3 flex flex-wrap gap-2">
        {GROUPS.map((x) => <Chip key={x.g} label={x.label} icon={x.icon} n={staged.counts[x.g]} pressed={group === x.g} onClick={() => { setGroup(x.g); setPage(1); }} />)}
      </div>
      {error && <p role="alert" className="text-body font-semibold text-red">{error}</p>}
      {data && (data.total === 0 ? <p className="text-body text-muted-foreground">No {g.label.toLowerCase()} rows.</p> : (
        <>
          <div className="tbox">
            <table className="tbl band table-fixed" aria-label={`Span list: ${g.label} rows`}>
              <thead><tr>
                <th scope="col" className="num w-16">Row</th>
                <th scope="col" className="w-[18%]">Link</th>
                <th scope="col" className="num w-28">Distance (km)</th>
                <th scope="col" className="w-[9%]">Route</th>
                <th scope="col" className="w-[9%]">Section</th>
                <th scope="col" className="w-[9%]">Type</th>
                <th scope="col">Status or reason</th>
              </tr></thead>
              <tbody>
                {data.items.map((r) => {
                  const tx = (v: string, cls = "") => <td className={`truncate ${cls}`} title={v === "—" ? undefined : v}>{v}</td>;
                  const link = cell(r.parsed.link, field(r.raw, /^links?$/i));
                  return (
                    <tr key={r.id}>
                      <td className="num text-muted-foreground">{r.row_number}</td>
                      <th scope="row" className="truncate text-left font-semibold" title={link === "—" ? undefined : link}>{link}</th>
                      {tx(cell(r.parsed.distance_km, field(r.raw, /^(distance|km)/i)), "num")}
                      {tx(cell(r.parsed.route, null))}
                      {tx(cell(r.parsed.section, null))}
                      {tx(cell(r.parsed.type, field(r.raw, /^(route\s*)?type$/i)))}
                      <td className="whitespace-normal! [&:has(*)]:h-auto! [&:has(*)]:py-1.5!">
                        <span className={`inline-flex items-center gap-1.5 ${g.cls === "h-amber" ? "font-semibold text-amber" : ""}`}><Icon name={g.icon} />{group === "problem" ? "Needs review" : g.label}</span>
                        {r.reason && <p className="text-body">{r.reason}</p>}
                        {group === "changed" && <Changes changes={r.changes.map((c) => ({ ...c, field: FIELD[c.field], note: "kept: edited in dashboard" }))} />}
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
  );
}

export function SpanListUpload() {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Applied | null>(null);

  const pick = async (f: File) => {
    setBusy(true); setError(null); setResult(null); setStaged(null); setConfirming(false);
    try {
      setStaged((await api.postFile("/api/admin/span-list/uploads", f)) as Staged);
    } catch (e) {
      setError(uploadError(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!staged) return;
    setError(null);
    try {
      setResult(await api.post("/api/admin/span-list/uploads/{upload_id}/apply", { path: { upload_id: staged.upload_id } }));
      setStaged(null);
    } catch (e) {
      setError(errorText(e, "Apply failed. Nothing was changed. Try again."));
    } finally {
      setConfirming(false);
    }
  };

  const blocked = staged && (!staged.found || staged.block_reason);
  const n = staged?.counts;
  const nothing = !!n && n.new + n.changed === 0;
  return (
    <div className="space-y-4">
      <section className="card" aria-labelledby="sl-h">
        <div className="card-h">
          <h2 id="sl-h">Span list</h2>
          </div>
        <div className="space-y-4">
          <FilePick label="Upload a span list" busy={busy} onFile={pick} />
          {error && <Note tone="red" role="alert" title={error} />}
          <div aria-live="polite" data-testid="sl-result">
            {result && (
              <Note tone="green" title="Span list applied">
                <p>{result.created} created, {result.changed} changed, {result.protected_kept} dashboard edits kept, {result.skipped} skipped.</p>
                {result.warnings.length > 0 && (
                  <><p className="mt-2 font-semibold">Warnings</p><ul className="list-disc pl-4">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul></>
                )}
              </Note>
            )}
          </div>
        </div>
      </section>
      {staged && n && (
        <section aria-labelledby="sl-prev-title" className="card" data-testid="sl-preview">
          <div className="card-h">
            <h2 id="sl-prev-title" className="truncate">Preview of {staged.filename}</h2>
          </div>
          <div className="space-y-4">
            <p className="text-body text-muted-foreground">
              {staged.found ? <>Found as worksheet <b className="font-semibold text-foreground">“{staged.sheet_name}”</b>, {n.rows.toLocaleString("en-GB")} rows</> : "Worksheet not found"}
            </p>
            {blocked ? (
              <Note tone="red" role="alert" title="This file will not be applied">{staged.block_reason ?? "No worksheet has the expected headers."}</Note>
            ) : (
              <>
                <Rows key={staged.upload_id} staged={staged} />
                <div className="flex flex-wrap items-center gap-4 border-t pt-4">
                  <button type="button" className="btn btn-p" disabled={nothing} aria-describedby={nothing ? "sl-why" : undefined} onClick={() => setConfirming(true)}>Apply span list…</button>
                  {nothing && <p id="sl-why" className="text-body text-muted-foreground">Nothing new or changed to apply.</p>}
                </div>
              </>
            )}
            <div className="border-t pt-4">
              <button type="button" className="btn" onClick={() => setStaged(null)}>Discard preview</button>
            </div>
          </div>
        </section>
      )}
      {confirming && n && (
        <Dialog title="Apply span list?" onClose={() => setConfirming(false)}>
          <p className="mt-3 text-body">{n.new} new, {n.changed} changed, {n.problem} need review and are skipped. Fields edited in the dashboard are kept.</p>
          <p className="mt-3 text-body text-muted-foreground">Changes are saved in one step with a history record per field. There is no undo.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="btn btn-p" onClick={apply} autoFocus>Apply</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
