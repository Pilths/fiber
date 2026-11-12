import { useCallback, useEffect, useState } from "react";
import { api, errorText, resAction } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { Blank } from "@/components/LossCard";
import { MeasurementDialog } from "@/components/MeasurementDialog";
import { Dialog } from "@/components/upload-parts";
import { LossDeviation } from "@/lib/lossLevel";
import { buildPortLabel, isPortPart, parsePortLabel, PORT_FIELDS, type PortKind } from "@/lib/portLabel";
import { db, EVENT_WORD, STATUS, statusLabel, when } from "@/lib/status";

type Core = components["schemas"]["CoreDetail"];
type Holder = components["schemas"]["Holder"];
type Item = components["schemas"]["CoreHistoryItem"];
type Me = components["schemas"]["CurrentUser"];
type CoreLoss = components["schemas"]["CoreLoss"];

const line = (h: Item) =>
  h.kind === "data_edit"
    ? `${h.type === "status" ? `Marked ${h.new_value == null ? "-" : statusLabel(h.new_value)}` : `${h.type} changed to ${h.new_value ?? "blank"}`} by ${h.user}`
    : `${EVENT_WORD[h.type] ?? h.type} by ${h.user}`;

// Core detail: right-side drawer on the native <dialog> (Esc closes, focus returns to the cell or row that opened it).
// The holder comes from GET /api/cores/{id}: everyone sees who holds a core; actions follow holder.is_mine or admin.
// Loss is per core: `calc` is the core's calculated loss (the segment's formula when the core has no row), `loss` its tests.
export function CoreDrawer({ core, segment, ends, me, onClose, onChanged, loss, calc }: {
  core: Core; segment: string; ends: [string, string]; me: Me; onClose: () => void; onChanged: () => void;
  loss: CoreLoss | null; calc: number | null;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [res, setRes] = useState<Holder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ports, setPorts] = useState(false);
  const [addingTest, setAddingTest] = useState(false);
  const admin = me.role === "admin";

  const load = useCallback(() => {
    api.get("/api/cores/{cid}/history", { path: { cid: core.id } }).then(setItems).catch(() => setError("Could not load the history."));
    api.get("/api/cores/{core_id}", { path: { core_id: core.id } }).then((c) => setRes(c.holder)).catch(() => setRes(null));
  }, [core.id]);
  useEffect(load, [load, core.status]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      load();
    } catch (e) {
      setError(errorText(e, "Action failed. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const st = STATUS[core.status];
  const canRequestRelease = res && (res.is_mine || admin) && res.state === "approved";
  const canKeep = canRequestRelease && res.stale;
  const canRelease = admin && res?.state === "release_requested";
  // The holder has no list of requested cores; admins see every reservation, so read it at click time.
  const release = async (rid: number) => {
    const r = (await api.get("/api/reservations")).find((x) => x.id === rid);
    return resAction(rid, "release", { cores: r?.release_requested_cores ?? [] });
  };
  const na = core.status === "Available" ? <Blank>Not applicable</Blank> : <Blank />;
  const facts: [string, React.ReactNode][] = [
    ["Customer", core.customer ?? na],
    ["Reserved by", res ? `${res.owner.display_name}, reservation #${res.reservation_id}` : <Blank key="r">Not applicable</Blank>],
    ["Ports", core.port_a || core.port_b ? <span key="p">{core.port_a ?? <Blank />} to {core.port_b ?? <Blank />}</span> : <Blank key="p">No ports yet</Blank>],
    ["Planned date", core.planned_date ?? na],
    ["Calculated loss", calc == null ? <Blank key="cl">No distance</Blank> : db(calc)],
    ["Measured loss", !loss ? <Blank key="ml">Not tested</Blank> : <span key="ml">
      {db(loss.measured_db)} <LossDeviation loss={loss} />
      {[loss.test_method, loss.tested_on, loss.field_team].filter(Boolean).map((x) => `, ${x}`).join("")}
    </span>],
  ];

  return (
    <Dialog title={`Core ${core.number} on ${segment}`} onClose={onClose}
      cls="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-[460px] max-w-none overflow-y-auto rounded-none border-y-0 border-r-0 [&>h2]:pr-20">
      <button type="button" className="btn btn-sm absolute top-4 right-4" onClick={onClose} aria-label="Close core detail">Close</button>
      <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="core-status">
        <span className={`inline-flex items-center gap-1.5 font-semibold ${st.tone}`}><Icon name={st.icon} />{statusLabel(core.status)}</span>
        {res?.stale && <span className="pill h-amber"><Icon name="lo" />Stale</span>}
        {res?.state === "release_requested" && <span className="pill h-blue"><Icon name="ex" />Release requested</span>}
      </div>
      <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 border-t pt-4 text-body">
        {facts.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
      </dl>
      {admin && (
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn btn-sm" onClick={() => setPorts(true)}>{core.port_a || core.port_b ? "Edit ports" : "Add ports"}</button>
          <button type="button" className="btn btn-sm" onClick={() => setAddingTest(true)}>Add test</button>
        </div>
      )}
      {ports && <PortsDialog core={core} ends={ends} onClose={() => setPorts(false)} onSaved={() => { onChanged(); load(); }} />}
      {addingTest && (
        <MeasurementDialog core={core} onClose={() => setAddingTest(false)}
          onSaved={() => {
            onChanged();
            load();
          }} />
      )}

      {error && <p role="alert" className="mt-4 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red">{error}</p>}

      {(canRequestRelease || canRelease) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
          {canKeep && <button type="button" className="btn" disabled={busy} onClick={() => act(() => resAction(res.reservation_id, "keep"))}>Keep</button>}
          {canRequestRelease && <button type="button" className="btn" disabled={busy} onClick={() => act(() => resAction(res.reservation_id, "request-release", { cores: [core.id] }))}>Request release of core {core.number}</button>}
          {canRelease && <button type="button" className="btn btn-p" disabled={busy} onClick={() => act(() => release(res.reservation_id))}>Release requested cores</button>}
        </div>
      )}

      {loss && loss.history.length > 0 && (
        <>
          <h3 className="mt-5 border-t pt-4 text-sm font-semibold">Measured loss tests</h3>
          <ol className="mt-2 text-body" aria-label="Measured loss tests, newest first">
            {loss.history.map((h, i) => (
              <li key={i} className="border-b border-rule py-2 last:border-b-0">
                <span className="font-semibold">{db(h.loss_db)}</span>{[h.test_method, h.tested_on, h.field_team].filter(Boolean).map((x) => `, ${x}`).join("")}
              </li>
            ))}
          </ol>
        </>
      )}

      <h3 className="mt-5 border-t pt-4 text-sm font-semibold">History</h3>
      {!items ? <p className="mt-2 text-body text-muted-foreground">Loading…</p>
        : items.length === 0 ? <p className="mt-2 text-body text-muted-foreground">No events on this core{admin ? "" : " that you can see"}.</p>
        : (
          <ol className="mt-2 text-body" aria-label="Core history, newest first">
            {items.map((h, i) => (
              <li key={i} className="border-b border-rule py-2 last:border-b-0">
                <span className="font-semibold">{line(h)}</span>
                {h.reservation_id != null && <span className="text-muted-foreground"> (reservation #{h.reservation_id})</span>}
                <span className="block text-muted-foreground">{when(h.at)}</span>
                {h.reason && <span className="block">Reason: {h.reason}</span>}
              </li>
            ))}
          </ol>
        )}
    </Dialog>
  );
}

type PortEnd = { kind: PortKind | ""; values: string[] };
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
  const showOldLabel = end.kind === "" && isUnparsedLabel(oldLabel);
  const chooseKind = (kind: string) => {
    if (kind === "FDF" || kind === "ODF") {
      onChange({ kind, values: PORT_FIELDS[kind].map(() => "") });
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
          <select className="field w-28" aria-label={`${name} type`} value={end.kind} autoFocus={autoFocus}
            onChange={(event) => chooseKind(event.target.value)}>
            <option value="">No port</option>
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
function PortsDialog({ core, ends, onClose, onSaved }: {
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
