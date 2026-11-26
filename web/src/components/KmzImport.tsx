import { useState } from "react";
import { Chevron } from "@/components/Chevron";
import { Icon } from "@/components/Icon";
import { KmzFolderTree } from "@/components/KmzFolderTree";
import { KmzImportMap } from "@/components/KmzImportMap";
import { Dialog, FilePick, Note } from "@/components/upload-parts";
import { plural } from "@/lib/format";
import { useKmzUpload, type KmzStaged } from "@/lib/useKmzUpload";
import { useKmzImport, type KmzImport, type RouteLine } from "@/lib/useKmzImport";

const KMZ = { accept: ".kmz,application/vnd.google-earth.kmz", button: "Choose .kmz file" };
const STEPS = ["Upload", "Select"] as const;
type Step = (typeof STEPS)[number];
// Line, Segment, Status columns, the same in every group; the last is wide enough for "Choose segment".
const GRID = "grid grid-cols-[24px_minmax(0,1.3fr)_minmax(0,1.4fr)_165px] items-center gap-2 px-2 text-center text-sm";

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

function ColumnHeads({ status }: { status: string }) {
  return (
    <div className={`${GRID} h-7 text-xs text-muted-foreground`} aria-hidden="true">
      <span />
      <span>Line</span>
      <span>Segment</span>
      <span>{status}</span>
    </div>
  );
}

function segmentName(state: KmzImport, segmentId: number | null): string {
  if (segmentId == null) {
    return "-";
  }
  return state.segments.get(segmentId)?.name ?? `Segment ${segmentId}`;
}

type RowProps = { line: RouteLine; state: KmzImport; onHover: (key: string | null) => void };

function Row({ line, onHover, children }: { line: RouteLine; onHover: (key: string | null) => void; children: React.ReactNode }) {
  return (
    <div className={`${GRID} h-10 rounded-md hover:bg-blue-bg focus-within:bg-blue-bg`}
      data-testid={`kmz-line-${line.name}`} tabIndex={0}
      onMouseEnter={() => onHover(line.key)} onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(line.key)} onBlur={() => onHover(null)}>
      {children}
    </div>
  );
}

function LineName({ line }: { line: RouteLine }) {
  return <span className="truncate" title={line.name}>{line.name}</span>;
}

function CheckRow({ line, state, onHover }: RowProps) {
  const options = [...state.segments.values()].sort((first, second) => first.name.localeCompare(second.name));
  const suggested = line.closest_segment_id ?? null;
  let action = (
    <select className="field h-8" value="" aria-label={`Segment for ${line.name}`}
      onChange={(event) => state.assign(line, Number(event.target.value))}>
      <option value="">Choose segment</option>
      {options.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
    </select>
  );
  if (suggested != null) {
    action = (
      <button type="button" className="btn btn-sm" aria-label={`Accept closest for ${line.name}`}
        onClick={() => state.assign(line, suggested)}>
        Accept
      </button>
    );
  }
  return (
    <Row line={line} onHover={onHover}>
      <span />
      <LineName line={line} />
      <span className="truncate">{segmentName(state, suggested)}</span>
      {action}
    </Row>
  );
}

function ReadyRow({ line, state, onHover }: RowProps) {
  const status = state.statusOf(line);
  let statusClass = "font-semibold text-green";
  if (status === "Route Replaced") {
    statusClass = "font-semibold text-amber";
  }
  return (
    <Row line={line} onHover={onHover}>
      <input type="checkbox" aria-label={`Include ${line.name}`} checked={state.ticked.has(line.key)}
        onChange={(event) => state.tick(line, event.target.checked)} />
      <LineName line={line} />
      <span className="truncate">{segmentName(state, state.assigned[line.key] ?? null)}</span>
      <span className={statusClass}>{status}</span>
    </Row>
  );
}

function SkippedRow({ line, state, onHover }: RowProps) {
  let word = "same";
  if (!line.same) {
    word = "duplicate";
  }
  return (
    <Row line={line} onHover={onHover}>
      <input type="checkbox" aria-label={`Include ${line.name}`} checked={false}
        disabled={state.segmentOf(line) == null} onChange={(event) => state.tick(line, event.target.checked)} />
      <LineName line={line} />
      <span className="truncate">{segmentName(state, state.segmentOf(line))}</span>
      <span className="text-muted-foreground">{word}</span>
    </Row>
  );
}

function SelectStep({ state }: { state: KmzImport }) {
  const [skippedOpen, setSkippedOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const check = state.inGroup("check");
  const ready = state.inGroup("ready");
  const skipped = state.inGroup("skipped");
  return (
    <div className="grid min-h-0 grid-cols-[760px_1fr] gap-6">
      <div className="flex min-h-0 flex-col gap-2 overflow-auto pr-2">
        {check.length > 0 && (
          <section aria-label="To check">
            <h3 className="flex h-10 items-center gap-2 font-semibold">To check <span className="font-normal text-muted-foreground">({check.length})</span></h3>
            <ColumnHeads status="" />
            {check.map((line) => <CheckRow key={line.key} line={line} state={state} onHover={setHovered} />)}
          </section>
        )}
        <section aria-label="Ready" className="border-t">
          <h3 className="flex h-10 items-center gap-2 font-semibold">Ready <span className="font-normal text-muted-foreground">({ready.length})</span></h3>
          <ColumnHeads status="Status" />
          {ready.map((line) => <ReadyRow key={line.key} line={line} state={state} onHover={setHovered} />)}
        </section>
        <section aria-label="Skipped" className="border-t">
          <h3 className="flex h-10 items-center gap-2 font-semibold">
            <button type="button" className="grid size-6 place-items-center rounded hover:bg-raised"
              aria-expanded={skippedOpen} aria-label="Show or hide Skipped" onClick={() => setSkippedOpen(!skippedOpen)}>
              <Chevron open={skippedOpen} />
            </button>
            Skipped <span className="font-normal text-muted-foreground">({skipped.length})</span>
          </h3>
          {skippedOpen && skipped.map((line) => <SkippedRow key={line.key} line={line} state={state} onHover={setHovered} />)}
        </section>
      </div>
      <div className="flex min-h-0 flex-col gap-3 border-l pl-6">
        <KmzImportMap state={state} hovered={hovered} />
      </div>
    </div>
  );
}

// Select step state lives under one staged upload; "Add n routes" saves the ticked Ready lines and the box closes.
function Staged({ staged, onBack, onApplied }: {
  staged: KmzStaged; onBack: () => void; onApplied: (saved: number) => void;
}) {
  const state = useKmzImport(staged.upload_id, staged.route_lines);
  const count = state.tickedLines.length;
  const add = async () => {
    const result = await state.apply();
    if (result) {
      onApplied(result.route_lines_saved);
    }
  };
  return (
    <>
      <Steps current="Select" />
      <div className="col-span-3 mt-4 flex min-h-0 flex-col self-stretch gap-3 border-t pt-4">
        <SelectStep state={state} />
        {state.error && <Note tone="red" role="alert" title={state.error} />}
      </div>
      <div className="col-span-3 flex items-center gap-4 border-t pt-4">
        <button type="button" className="btn" onClick={onBack}>Back</button>
        <span className="flex-1" />
        <button type="button" className="btn btn-p" disabled={state.busy || count === 0} onClick={add}>
          Add {plural(count, "route")}
        </button>
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

// "Import KMZ": Upload (file, folders) -> Select (To check, Ready, Skipped) -> Add routes, then the box closes.
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
