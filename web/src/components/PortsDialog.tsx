import { useState } from "react";
import { api, errorText } from "@/api/client";
import type { components } from "@/api/schema";
import { Dialog } from "@/components/upload-parts";
import { buildPortLabel, isPortPart, parsePortLabel, PORT_FIELDS, type PortKind } from "@/lib/portLabel";

type Core = components["schemas"]["CoreDetail"];

// clear: the admin chose "No port" on an end that holds an old label (the picker starts on "Keep old label").
type PortEnd = { kind: PortKind | ""; values: string[]; clear?: boolean };
type PortsBody = components["schemas"]["CorePortsBody"];

const PORT_ERROR_CLASS =
  "mt-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red";

// An old free-text label does not parse; its picker starts empty and the label stays until a type is chosen.
function startingEnd(label: string | null): PortEnd {
  if (label == null) {
    return { kind: "", values: [] };
  }
  const parts = parsePortLabel(label);
  if (parts == null) {
    return { kind: "", values: [] };
  }
  return parts;
}

function isUnparsedLabel(label: string | null): boolean {
  return label != null && parsePortLabel(label) == null;
}

function endIsIncomplete(end: PortEnd): boolean {
  if (end.kind === "") {
    return false;
  }
  return buildPortLabel({ kind: end.kind, values: end.values }) == null;
}

// The value to send for one end; undefined leaves that end untouched on the server.
function endValue(end: PortEnd, oldLabel: string | null): string | null | undefined {
  if (end.kind === "") {
    if (end.clear) {
      return null;
    }
    if (oldLabel == null || isUnparsedLabel(oldLabel)) {
      return undefined;
    }
    return null;
  }
  const label = buildPortLabel({ kind: end.kind, values: end.values });
  if (label === oldLabel) {
    return undefined;
  }
  return label;
}

function changedPorts(core: Core, endA: PortEnd, endB: PortEnd): PortsBody | null {
  const body: PortsBody = { reason: "" };
  const portA = endValue(endA, core.port_a ?? null);
  const portB = endValue(endB, core.port_b ?? null);
  if (portA !== undefined) {
    body.port_a = portA;
  }
  if (portB !== undefined) {
    body.port_b = portB;
  }
  if (portA === undefined && portB === undefined) {
    return null;
  }
  return body;
}

function usePortsForm(core: Core, onClose: () => void, onSaved: () => void) {
  const [endA, setEndA] = useState<PortEnd>(() => startingEnd(core.port_a ?? null));
  const [endB, setEndB] = useState<PortEnd>(() => startingEnd(core.port_b ?? null));
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (endIsIncomplete(endA) || endIsIncomplete(endB)) {
      return;
    }
    const body = changedPorts(core, endA, endB);
    if (body == null) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/admin/cores/{core_id}/ports", { path: { core_id: core.id }, body });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not save. Try again."));
      setBusy(false);
    }
  };

  return {
    endA,
    setEndA,
    endB,
    setEndB,
    incompleteA: checked && endIsIncomplete(endA),
    incompleteB: checked && endIsIncomplete(endB),
    busy,
    error,
    submit,
  };
}

function PortEndPicker({ name, site, oldLabel, end, onChange, incomplete, autoFocus }: {
  name: string;
  site: string;
  oldLabel: string | null;
  end: PortEnd;
  onChange: (end: PortEnd) => void;
  incomplete: boolean;
  autoFocus?: boolean;
}) {
  const fields = end.kind === "" ? [] : PORT_FIELDS[end.kind];
  const hasOldLabel = isUnparsedLabel(oldLabel);
  const showOldLabel = end.kind === "" && !end.clear && hasOldLabel;
  const chooseKind = (kind: string) => {
    if (kind === "FDF" || kind === "ODF") {
      onChange({ kind, values: PORT_FIELDS[kind].map(() => "") });
    } else if (kind === "CLEAR") {
      onChange({ kind: "", values: [], clear: true });
    } else {
      onChange({ kind: "", values: [] });
    }
  };
  const setPart = (index: number, text: string) => {
    const typed = text.toUpperCase();
    const values = end.values.map((value, i) => (i === index ? typed : value));
    onChange({ kind: end.kind, values });
  };
  return (
    <fieldset>
      <legend className="lbl mb-1 block text-body! text-foreground!">Port at {site}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="block text-body">Type</span>
          <select className="field w-28" aria-label={`${name} type`} value={end.clear ? "CLEAR" : end.kind}
            autoFocus={autoFocus} onChange={(event) => chooseKind(event.target.value)}>
            <option value="">{hasOldLabel ? "Keep old label" : "No port"}</option>
            {hasOldLabel && <option value="CLEAR">No port</option>}
            <option value="FDF">FDF</option>
            <option value="ODF">ODF</option>
          </select>
        </label>
        {fields.map((field, index) => (
          <label key={field} className="block">
            <span className="block text-body">{field}</span>
            <input className="field w-20" type="text" maxLength={4} inputMode="text"
              autoCapitalize="characters" spellCheck={false}
              aria-label={`${name} ${field}`} aria-invalid={incomplete && !isPortPart(end.values[index])}
              value={end.values[index]} onChange={(event) => setPart(index, event.target.value)} />
          </label>
        ))}
      </div>
      {showOldLabel && <p className="mt-1 text-body">Old label: {oldLabel}</p>}
      {incomplete && (
        <p className="mt-1 text-body font-semibold text-red">Fill every part: 1 to 4 letters or numbers.</p>
      )}
    </fieldset>
  );
}

// Ports are entered by hand (the reservation upload does not import them). "No port" clears that end.
export function PortsDialog({ core, ends, onClose, onSaved }: {
  core: Core;
  ends: [string, string];
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = usePortsForm(core, onClose, onSaved);
  return (
    <Dialog title={`Ports of core ${core.number}`} onClose={onClose}>
      {form.error && <p role="alert" className={PORT_ERROR_CLASS}>{form.error}</p>}
      <form onSubmit={form.submit} noValidate aria-label={`Ports of core ${core.number}`}
        className="mt-4 space-y-4">
        <PortEndPicker name="Site A end" site={ends[0]} oldLabel={core.port_a ?? null} end={form.endA}
          onChange={form.setEndA} incomplete={form.incompleteA} autoFocus />
        <PortEndPicker name="Site B end" site={ends[1]} oldLabel={core.port_b ?? null} end={form.endB}
          onChange={form.setEndB} incomplete={form.incompleteB} />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-p" disabled={form.busy}>
            {form.busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
