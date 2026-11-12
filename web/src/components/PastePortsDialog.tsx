import { Dialog } from "@/components/upload-parts";
import { coreCount } from "@/lib/portLabel";
import { usePastePorts, type PastePortRow, type PastePortsResult } from "@/lib/usePastePorts";

const LABEL_CLASS = "lbl mb-1 block text-body! text-foreground!";
const TEXTAREA_CLASS = "field h-36 resize-y py-2 font-mono";
const ERROR_CLASS = "mt-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red";

function PortBox({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const cores = coreCount(value);
  const coreWord = cores === 1 ? "core" : "cores";
  return (
    <div>
      <label className="block">
        <span className={LABEL_CLASS}>{label}</span>
        <textarea className={TEXTAREA_CLASS} value={value} onChange={(event) => onChange(event.target.value)}
          spellCheck={false} />
      </label>
      <span className="mt-1 block text-body text-muted-foreground">{cores} {coreWord}</span>
    </div>
  );
}

// New port in place of the old one; an untouched end shows the old port.
function PortCell({ oldPort, newPort }: { oldPort: string | null; newPort: string | null }) {
  return <td className="px-2 py-1 font-mono">{newPort ?? oldPort ?? "-"}</td>;
}

function replacedPorts(row: PastePortRow): string {
  const old: string[] = [];
  if (row.port_a_new != null && row.port_a_old != null && row.port_a_new !== row.port_a_old) {
    old.push(row.port_a_old);
  }
  if (row.port_b_new != null && row.port_b_old != null && row.port_b_new !== row.port_b_old) {
    old.push(row.port_b_old);
  }
  return old.join(", ");
}

function CheckCell({ row }: { row: PastePortRow }) {
  if (row.status === "new") {
    return <td className="px-2 py-1 font-semibold text-green">✓ New</td>;
  }
  if (row.status === "replaces") {
    return <td className="px-2 py-1 font-semibold text-amber">▲ Replaces {replacedPorts(row)}</td>;
  }
  if (row.status === "unchanged") {
    return <td className="px-2 py-1 text-muted-foreground">Unchanged</td>;
  }
  return <td className="px-2 py-1 font-semibold text-red">✗ {row.problem}</td>;
}

function PreviewTable({ result, siteA, siteB }: { result: PastePortsResult; siteA: string; siteB: string }) {
  return (
    <div className="mt-4 max-h-72 overflow-y-auto rounded-md border">
      <table className="w-full text-body" aria-label="Paste ports preview">
        <thead className="sticky top-0 bg-subtle text-left">
          <tr>
            <th className="px-2 py-1">Core</th>
            <th className="px-2 py-1">{siteA} end</th>
            <th className="px-2 py-1">{siteB} end</th>
            <th className="px-2 py-1">Check</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.core_number} className="border-t border-rule" data-status={row.status}>
              <td className="px-2 py-1">{row.core_number}</td>
              <PortCell oldPort={row.port_a_old} newPort={row.port_a_new} />
              <PortCell oldPort={row.port_b_old} newPort={row.port_b_new} />
              <CheckCell row={row} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function countsText(result: PastePortsResult): string {
  const parts = [`${result.counts.new} ready`];
  if (result.counts.replaces > 0) {
    parts.push(`${result.counts.replaces} replaces`);
  }
  if (result.counts.unchanged > 0) {
    parts.push(`${result.counts.unchanged} unchanged`);
  }
  if (result.counts.problem > 0) {
    const word = result.counts.problem === 1 ? "problem" : "problems";
    parts.push(`${result.counts.problem} ${word}`);
  }
  return parts.join(" · ");
}

export function PastePortsDialog({ segmentId, siteA, siteB, cores, onClose, onApplied }: {
  segmentId: number;
  siteA: string;
  siteB: string;
  cores: number;
  onClose: () => void;
  onApplied: () => void;
}) {
  const paste = usePastePorts(segmentId, onApplied);
  const applyWord = paste.ready === 1 ? "core" : "cores";
  const applyOff = paste.ready === 0 || paste.busy;
  const title = `Paste ports · ${siteA} – ${siteB} · ${cores} cores`;
  return (
    <Dialog title={title} onClose={onClose} cls="m-auto w-[760px]">
      {paste.error && <p role="alert" className={ERROR_CLASS}>{paste.error}</p>}
      <label className="mt-4 flex items-center gap-2 text-body">
        <span className="font-semibold">Start at core</span>
        <input className="field w-20" type="number" min="1" step="1" value={paste.startCore}
          onChange={(event) => paste.setStartCore(event.target.value)} />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <PortBox label={`${siteA} end`} value={paste.portA} onChange={paste.setPortA} />
        <PortBox label={`${siteB} end`} value={paste.portB} onChange={paste.setPortB} />
      </div>
      {paste.result && <PreviewTable result={paste.result} siteA={siteA} siteB={siteB} />}
      {paste.result && <p className="mt-2 text-body" role="status">{countsText(paste.result)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-p" disabled={applyOff} onClick={paste.apply}>
          Apply {paste.ready} {applyWord}
        </button>
      </div>
    </Dialog>
  );
}
