import { useEffect, useRef, useState } from "react";
import { Chevron } from "@/components/Chevron";
import { Icon } from "@/components/Icon";
import { KmzFolderTree } from "@/components/KmzFolderTree";
import { KmzImportMap } from "@/components/KmzImportMap";
import { Dialog, FilePick, Note } from "@/components/upload-parts";
import { plural } from "@/lib/format";
import { useKmzUpload, type KmzStaged } from "@/lib/useKmzUpload";
import { unmatchedReason, useKmzImport, type KmzImport, type RouteLine } from "@/lib/useKmzImport";

const KMZ = { accept: ".kmz,application/vnd.google-earth.kmz", button: "Choose .kmz file" };
const STEPS = ["Upload", "Select", "Confirm"] as const;
type Step = (typeof STEPS)[number];
const SOURCE_CLASS = { title: "text-muted-foreground", suggested: "font-semibold text-blue", added: "text-muted-foreground" };

function Steps({ current }: { current: Step }) {
  return (
    <ol className="flex items-center gap-3 text-body" aria-label="Steps">
      {STEPS.map((step, index) => {
        const isCurrent = step === current;
        let badge = "border border-line bg-white text-foreground";
        if (isCurrent) {
          badge = "bg-foreground text-white";
        }
        return (
          <li key={step} className="flex items-center gap-3" aria-current={isCurrent ? "step" : undefined}>
            {index > 0 && <span className="h-px w-8 bg-line" aria-hidden="true" />}
            <span className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${badge}`}>{index + 1}</span>
            <span className={isCurrent ? "font-semibold" : ""}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Checkbox that shows "some ticked" as indeterminate.
function TriBox({ ticked, total, label, onChange }: {
  ticked: number; total: number; label: string; onChange: (checked: boolean) => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) {
      box.current.indeterminate = ticked > 0 && ticked < total;
    }
  }, [ticked, total]);
  return (
    <input ref={box} type="checkbox" aria-label={label} checked={total > 0 && ticked === total}
      onChange={(event) => onChange(event.target.checked)} />
  );
}

function LineRow({ line, state }: { line: RouteLine; state: KmzImport }) {
  const source = state.assigned[line.key].source;
  let rowClass = "";
  if (source === "suggested") {
    rowClass = "rounded-md border border-dashed border-blue bg-blue-bg font-semibold";
  }
  return (
    <li className={`flex items-center gap-3 px-2 py-1.5 text-body ${rowClass}`} data-testid={`kmz-line-${line.name}`}>
      <input type="checkbox" aria-label={`Include ${line.name}`} checked={state.ticked.has(line.key)}
        onChange={(event) => state.setTick([line.key], event.target.checked)} />
      <span className="min-w-0 flex-1 truncate" title={line.name}>{line.name}</span>
      <span className="truncate text-muted-foreground" title={line.folder_path}>{line.folder_path}</span>
      <span className={`w-20 text-right ${SOURCE_CLASS[source]}`}>{source}</span>
    </li>
  );
}

function SegmentRow({ segmentId, state, open, onOpenClose, onAdd }: {
  segmentId: number; state: KmzImport; open: boolean; onOpenClose: () => void; onAdd: () => void;
}) {
  const segment = state.segments.get(segmentId);
  const name = segment?.name ?? `Segment ${segmentId}`;
  const lines = state.linesOf(segmentId);
  const keys = lines.map((line) => line.key);
  const tickedCount = keys.filter((key) => state.ticked.has(key)).length;
  return (
    <li data-testid={`kmz-segment-${name}`}>
      <div className="flex items-center gap-2 py-2 text-body">
        <TriBox ticked={tickedCount} total={keys.length} label={`Include ${name}`}
          onChange={(checked) => state.setTick(keys, checked)} />
        <button type="button" className="grid size-6 place-items-center rounded hover:bg-raised" aria-expanded={open}
          aria-label={`Open or close ${name}`} onClick={onOpenClose}>
          <Chevron open={open} />
        </button>
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
        <span>{plural(lines.length, "line")}</span>
        {segment?.shaped && <span className="font-semibold text-amber">· replaces line</span>}
      </div>
      {open && (
        <div className="pb-2 pl-8">
          <ul className="space-y-1">
            {lines.map((line) => <LineRow key={line.key} line={line} state={state} />)}
          </ul>
          <button type="button" className="btn btn-sm mt-2" onClick={onAdd}>+ Add from file</button>
        </div>
      )}
    </li>
  );
}

function Unmatched({ state }: { state: KmzImport }) {
  const [message, setMessage] = useState<string | null>(null);
  const options = [...state.segments.values()].sort((first, second) => first.name.localeCompare(second.name));
  const suggest = async () => {
    const found = await state.suggestByLocation();
    setMessage(`${plural(found, "suggestion")} found`);
  };
  return (
    <section className="rounded-md border border-amber-bd bg-amber-bg" aria-labelledby="kmz-unmatched-h">
      <div className="flex items-center gap-3 px-3 py-2">
        <h3 id="kmz-unmatched-h" className="flex-1 font-semibold">Not matched ({state.unmatched.length})</h3>
        <span role="status" className="text-body">{message}</span>
        <button type="button" className="btn btn-sm" disabled={state.busy || state.unmatched.length === 0}
          onClick={suggest}>
          Suggest by location
        </button>
      </div>
      <ul>
        {state.unmatched.map((line) => (
          <li key={line.key} className="flex items-center gap-3 border-t border-amber-bd px-3 py-1.5 text-body">
            <span className="min-w-0 flex-1 truncate" title={line.name}>{line.name}</span>
            <span className="font-semibold text-amber">{unmatchedReason(line)}</span>
            <select className="field w-56" value="" aria-label={`Segment for ${line.name}`}
              onChange={(event) => state.assign([line.key], Number(event.target.value))}>
              <option value="">-</option>
              {options.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
            </select>
          </li>
        ))}
      </ul>
    </section>
  );
}

// "Add to SEGMENT": every line in the file by folder; a line under another segment says it moves.
function AddFromFile({ state, segmentId, onDone }: { state: KmzImport; segmentId: number; onDone: () => void }) {
  const [search, setSearch] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const name = state.segments.get(segmentId)?.name ?? `Segment ${segmentId}`;
  const query = search.trim().toLowerCase();
  const shown = state.lines.filter((line) => {
    if (onlyUnmatched && state.assigned[line.key] != null) {
      return false;
    }
    return line.name.toLowerCase().includes(query) || line.folder_path.toLowerCase().includes(query);
  });
  const folders = [...new Set(shown.map((line) => line.folder_path))];
  const flip = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    return next;
  };
  const add = () => {
    state.assign([...picked], segmentId);
    onDone();
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" aria-labelledby="kmz-add-h">
      <h3 id="kmz-add-h" className="font-semibold">Add to {name}</h3>
      <input className="field" type="search" placeholder="Search the whole file" aria-label="Search the whole file"
        value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="flex gap-2">
        <button type="button" className="chip" aria-pressed={!onlyUnmatched} onClick={() => setOnlyUnmatched(false)}>All</button>
        <button type="button" className="chip" aria-pressed={onlyUnmatched} onClick={() => setOnlyUnmatched(true)}>Not matched</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border p-2">
        {folders.length === 0 && <p className="p-2 text-body text-muted-foreground">No lines</p>}
        <ul>
          {folders.map((folder) => {
            const open = !closed.has(folder);
            const folderLines = shown.filter((line) => line.folder_path === folder);
            return (
              <li key={folder}>
                <div className="flex items-center gap-2 py-1 text-body">
                  <button type="button" className="grid size-6 place-items-center rounded hover:bg-raised"
                    aria-expanded={open} aria-label={`Open or close ${folder}`}
                    onClick={() => setClosed(flip(closed, folder))}>
                    <Chevron open={open} />
                  </button>
                  <span className="flex-1 font-semibold">{folder}</span>
                  <span className="text-muted-foreground">{plural(folderLines.length, "line")}</span>
                </div>
                {open && (
                  <ul className="pl-8">
                    {folderLines.map((line) => {
                      const current = state.assigned[line.key];
                      const here = current?.segmentId === segmentId;
                      let moves = null;
                      if (current && !here) {
                        const from = state.segments.get(current.segmentId)?.name ?? `Segment ${current.segmentId}`;
                        moves = <span className="font-semibold text-amber">moves from {from}</span>;
                      }
                      return (
                        <li key={line.key} className="flex items-center gap-3 py-1 text-body">
                          <input type="checkbox" aria-label={`Pick ${line.name}`} disabled={here}
                            checked={here || picked.has(line.key)} onChange={() => setPicked(flip(picked, line.key))} />
                          <span className="min-w-0 flex-1 truncate">{line.name}</span>
                          {moves}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex items-center gap-3 border-t pt-3">
        <span className="flex-1 font-semibold">{picked.size} selected</span>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="button" className="btn btn-p" disabled={picked.size === 0} onClick={add}>
          Add {plural(picked.size, "line")}
        </button>
      </div>
    </section>
  );
}

function SelectStep({ state, filename }: { state: KmzImport; filename: string }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<number>>(() => new Set(state.segmentOrder.slice(0, 1)));
  const [addTo, setAddTo] = useState<number | null>(null);
  const query = search.trim().toLowerCase();
  const shown = state.segmentOrder.filter((segmentId) => {
    const name = state.segments.get(segmentId)?.name ?? "";
    if (name.toLowerCase().includes(query)) {
      return true;
    }
    return state.linesOf(segmentId).some((line) => line.name.toLowerCase().includes(query));
  });
  const allKeys = state.segmentOrder.flatMap((segmentId) => state.linesOf(segmentId).map((line) => line.key));
  const openClose = (segmentId: number) => {
    const next = new Set(open);
    if (next.has(segmentId)) {
      next.delete(segmentId);
    } else {
      next.add(segmentId);
    }
    setOpen(next);
  };
  return (
    <div className="grid min-h-0 grid-cols-2 gap-6">
      <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-2">
        <div className="flex items-baseline gap-4">
          <h3 className="flex-1 font-semibold">Segments in {filename} ({state.segmentOrder.length})</h3>
          <button type="button" className="link" onClick={() => state.setTick(allKeys, true)}>Select all</button>
          <button type="button" className="link" onClick={() => state.setTick(allKeys, false)}>Clear</button>
          <button type="button" className="link" onClick={() => setOpen(new Set())}>Collapse</button>
        </div>
        <input className="field" type="search" placeholder="Search segments" aria-label="Search segments"
          value={search} onChange={(event) => setSearch(event.target.value)} />
        {state.segmentOrder.length === 0 && <p className="text-body text-muted-foreground">No segments yet</p>}
        <ul>
          {shown.map((segmentId) => (
            <SegmentRow key={segmentId} segmentId={segmentId} state={state} open={open.has(segmentId)}
              onOpenClose={() => openClose(segmentId)} onAdd={() => setAddTo(segmentId)} />
          ))}
        </ul>
        {state.unmatched.length > 0 && <Unmatched state={state} />}
      </div>
      <div className="flex min-h-0 flex-col gap-3 border-l pl-6">
        {addTo == null && (
          <>
            <h3 className="font-semibold">Map preview</h3>
            <KmzImportMap state={state} />
          </>
        )}
        {addTo != null && <AddFromFile key={addTo} state={state} segmentId={addTo} onDone={() => setAddTo(null)} />}
      </div>
    </div>
  );
}

function ConfirmStep({ state, filename }: { state: KmzImport; filename: string }) {
  const rows = state.segmentOrder.filter((segmentId) => state.tickedSegments.has(segmentId));
  return (
    <div className="space-y-3 overflow-auto">
      <h3 className="font-semibold">{filename}</h3>
      <div className="tbox">
        <table className="tbl band" aria-label="Lines to apply">
          <thead>
            <tr>
              <th scope="col">Segment</th>
              <th scope="col">Lines</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((segmentId) => {
              const segment = state.segments.get(segmentId);
              const lines = state.tickedLines.filter((line) => state.assigned[line.key].segmentId === segmentId);
              const suggested = lines.filter((line) => state.assigned[line.key].source === "suggested").length;
              let note = <>-</>;
              if (segment?.shaped) {
                note = <span className="font-semibold text-amber">replaces line</span>;
              }
              return (
                <tr key={segmentId}>
                  <th scope="row" className="font-semibold">{segment?.name ?? `Segment ${segmentId}`}</th>
                  <td>
                    {lines.length}
                    {suggested > 0 && <b className="ml-2 text-blue">{suggested} suggested</b>}
                  </td>
                  <td>{note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function applyLabel(state: KmzImport): string {
  const picked = state.tickedLines.length - state.suggestedCount;
  if (state.suggestedCount === 0) {
    return `Apply ${plural(picked, "line")}`;
  }
  return `Apply ${picked} + ${state.suggestedCount} suggested`;
}

// Select and Confirm share the line state, so they live under one staged upload.
function Staged({ staged, onBack, onApplied }: {
  staged: KmzStaged; onBack: () => void; onApplied: (saved: number) => void;
}) {
  const state = useKmzImport(staged.upload_id, staged.route_lines);
  const [step, setStep] = useState<Step>("Select");
  const counts = [
    plural(state.tickedSegments.size, "segment"),
    plural(state.tickedLines.length, "line"),
    `${state.unmatched.length} not matched`,
  ].join(" · ");
  const back = () => {
    if (step === "Confirm") {
      setStep("Select");
    } else {
      onBack();
    }
  };
  const apply = async () => {
    const result = await state.apply();
    if (result) {
      onApplied(result.route_lines_saved);
    }
  };
  return (
    <>
      <Steps current={step} />
      <div className="col-span-3 mt-4 flex min-h-0 flex-col self-stretch gap-3 border-t pt-4">
        {step === "Select" && <SelectStep state={state} filename={staged.filename} />}
        {step === "Confirm" && <ConfirmStep state={state} filename={staged.filename} />}
        {state.error && <Note tone="red" role="alert" title={state.error} />}
      </div>
      <div className="col-span-3 flex items-center gap-4 border-t pt-4">
        <button type="button" className="btn" onClick={back}>Back</button>
        <span className="flex-1 text-right text-body" data-testid="kmz-import-counts">{counts}</span>
        {step === "Select" && (
          <button type="button" className="btn btn-p" disabled={state.tickedLines.length === 0}
            onClick={() => setStep("Confirm")}>
            Continue
          </button>
        )}
        {step === "Confirm" && (
          <button type="button" className="btn btn-p" disabled={state.busy || state.tickedLines.length === 0}
            onClick={apply}>
            {applyLabel(state)}
          </button>
        )}
      </div>
    </>
  );
}

function UploadStep({ upload }: { upload: ReturnType<typeof useKmzUpload> }) {
  return (
    <>
      <Steps current="Upload" />
      <div className="col-span-3 mt-4 min-h-0 space-y-4 self-stretch overflow-auto border-t pt-4">
        <FilePick label="Upload a KMZ file" busy={upload.busy} onFile={upload.pick} kind={KMZ} />
        {upload.folders.length > 0 && (
          <KmzFolderTree nodes={upload.folders} selected={upload.selected} onToggle={upload.toggle}
            onSelectAll={upload.selectAll} onSelectNone={upload.selectNone} />
        )}
        {upload.error && <Note tone="red" role="alert" title={upload.error} />}
      </div>
      <div className="col-span-3 flex items-center justify-end border-t pt-4">
        <button type="button" className="btn btn-p" disabled={!upload.canPreview} onClick={upload.preview}>
          Continue
        </button>
      </div>
    </>
  );
}

// "Import KMZ": Upload (file, folders) -> Select (lines per segment) -> Confirm -> apply, then the box closes.
export function KmzImportBox({ onClose, onApplied }: { onClose: () => void; onApplied: (saved: number) => void }) {
  const upload = useKmzUpload();
  const staged = upload.staged;
  const close = (
    <button type="button" aria-label="Close"
      className="col-start-3 row-start-1 grid size-8 place-items-center rounded hover:bg-raised"
      onClick={onClose}>
      <Icon name="fl" className="size-4" />
    </button>
  );
  return (
    <Dialog title="KMZ import" onClose={onClose}
      cls="m-auto h-[calc(100vh-64px)] w-[1240px] max-w-[calc(100vw-32px)] open:grid grid-cols-[auto_1fr_auto]
        grid-rows-[auto_minmax(0,1fr)_auto] items-center gap-x-8 gap-y-0">
      {staged == null && <UploadStep upload={upload} />}
      {staged != null && (
        <Staged key={staged.upload_id} staged={staged} onBack={upload.discard} onApplied={onApplied} />
      )}
      {close}
    </Dialog>
  );
}
