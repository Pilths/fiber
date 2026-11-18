import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, errorText, resAction } from "@/api/client";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { Blank } from "@/components/LossCard";
import { MeasurementDialog } from "@/components/MeasurementDialog";
import { PortsDialog } from "@/components/PortsDialog";
import { Dialog } from "@/components/upload-parts";
import { LossDeviation } from "@/lib/lossLevel";
import { db, EVENT_WORD, segmentName, STATUS, statusLabel, when } from "@/lib/status";
import type { Detail, Inventory } from "@/lib/useInventory";

type Core = components["schemas"]["CoreDetail"];
type Holder = components["schemas"]["Holder"];
type Item = components["schemas"]["CoreHistoryItem"];
type Me = components["schemas"]["CurrentUser"];
type CoreLoss = components["schemas"]["CoreLoss"];

const DRAWER_CLASS =
  "fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-[460px] max-w-none overflow-y-auto rounded-none " +
  "border-y-0 border-r-0 [&>h2]:pr-20";
const ERROR_CLASS = "mt-4 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red";

function dataEditText(item: Item): string {
  if (item.type !== "status") {
    return `${item.type} changed to ${item.new_value ?? "blank"}`;
  }
  if (item.new_value == null) {
    return "Marked -";
  }
  return `Marked ${statusLabel(item.new_value)}`;
}

function historyLine(item: Item): string {
  if (item.kind === "data_edit") {
    return `${dataEditText(item)} by ${item.user}`;
  }
  return `${EVENT_WORD[item.type] ?? item.type} by ${item.user}`;
}

// ", method, date, team" for the parts a test has.
const testDetails = (parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).map((part) => `, ${part}`).join("");

// The drawer's data (history and holder) and its reservation actions.
function useCoreDrawer(core: Core, me: Me, onChanged: () => void) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [holder, setHolder] = useState<Holder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const admin = me.role === "admin";

  const load = useCallback(() => {
    api.get("/api/cores/{core_id}/history", { path: { core_id: core.id } })
      .then(setItems)
      .catch(() => setError("Could not load the history."));
    api.get("/api/cores/{core_id}", { path: { core_id: core.id } })
      .then((detail) => setHolder(detail.holder))
      .catch(() => setHolder(null));
  }, [core.id]);
  useEffect(load, [load, core.status]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      load();
    } catch (failure) {
      setError(errorText(failure, "Action failed. Try again."));
    } finally {
      setBusy(false);
    }
  };
  const changedAndReload = () => {
    onChanged();
    load();
  };

  const canRequestRelease = holder && (holder.is_mine || admin) && holder.state === "approved";
  return {
    items,
    holder,
    error,
    busy,
    admin,
    act,
    changedAndReload,
    canRequestRelease,
    canKeep: canRequestRelease && holder.stale,
    canRelease: admin && holder?.state === "release_requested",
  };
}

type Drawer = ReturnType<typeof useCoreDrawer>;

// The holder has no list of requested cores; admins see every reservation, so read it at click time.
async function releaseRequestedCores(reservationId: number) {
  const reservations = await api.get("/api/reservations");
  const reservation = reservations.find((each) => each.id === reservationId);
  return resAction(reservationId, "release", { cores: reservation?.release_requested_cores ?? [] });
}

// Core detail: right-side drawer on the native <dialog> (Esc closes, focus returns to the cell or row that opened it).
// The holder comes from GET /api/cores/{id}: everyone sees who holds a core; actions follow holder.is_mine or admin.
// Loss is per core: `calc` is the core's calculated loss (the segment's formula when the core has no row),
// `loss` its tests.
export function CoreDrawer({ core, segment, ends, me, onClose, onChanged, loss, calc }: {
  core: Core;
  segment: string;
  ends: [string, string];
  me: Me;
  onClose: () => void;
  onChanged: () => void;
  loss: CoreLoss | null;
  calc: number | null;
}) {
  const drawer = useCoreDrawer(core, me, onChanged);
  const [editingPorts, setEditingPorts] = useState(false);
  const [addingTest, setAddingTest] = useState(false);
  const look = STATUS[core.status];
  const holder = drawer.holder;
  const hasPorts = core.port_a || core.port_b;

  return (
    <Dialog title={`Core ${core.number} on ${segment}`} onClose={onClose} cls={DRAWER_CLASS}>
      <button type="button" className="btn btn-sm absolute top-4 right-4" onClick={onClose}
        aria-label="Close core detail">
        Close
      </button>
      <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="core-status">
        <span className={`inline-flex items-center gap-1.5 font-semibold ${look.tone}`}>
          <Icon name={look.icon} />{statusLabel(core.status)}
        </span>
        {holder?.stale && <span className="pill h-amber"><Icon name="lo" />Stale</span>}
        {holder?.state === "release_requested" && (
          <span className="pill h-blue"><Icon name="ex" />Release requested</span>
        )}
      </div>
      <CoreFacts core={core} holder={holder} loss={loss} calc={calc} />
      {drawer.admin && (
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn btn-sm" onClick={() => setEditingPorts(true)}>
            {hasPorts ? "Edit ports" : "Add ports"}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setAddingTest(true)}>Add test</button>
        </div>
      )}
      {editingPorts && (
        <PortsDialog core={core} ends={ends} onClose={() => setEditingPorts(false)}
          onSaved={drawer.changedAndReload} />
      )}
      {addingTest && (
        <MeasurementDialog core={core} onClose={() => setAddingTest(false)} onSaved={drawer.changedAndReload} />
      )}

      {drawer.error && <p role="alert" className={ERROR_CLASS}>{drawer.error}</p>}

      <ReservationActions core={core} drawer={drawer} />
      {loss && loss.history.length > 0 && <LossTests loss={loss} />}
      <CoreHistory items={drawer.items} admin={drawer.admin} />
    </Dialog>
  );
}

function measuredLoss(loss: CoreLoss | null): ReactNode {
  if (!loss) {
    return <Blank key="ml">Not tested</Blank>;
  }
  return (
    <span key="ml">
      {db(loss.measured_db)} <LossDeviation loss={loss} />
      {testDetails([loss.test_method, loss.tested_on, loss.field_team])}
    </span>
  );
}

function CoreFacts({ core, holder, loss, calc }: {
  core: Core;
  holder: Holder | null;
  loss: CoreLoss | null;
  calc: number | null;
}) {
  const notApplicable = core.status === "Available" ? <Blank>Not applicable</Blank> : <Blank />;
  const reservedBy = holder
    ? `${holder.owner.display_name}, reservation #${holder.reservation_id}`
    : <Blank key="r">Not applicable</Blank>;
  const ports = core.port_a || core.port_b
    ? <span key="p">{core.port_a ?? <Blank />} to {core.port_b ?? <Blank />}</span>
    : <Blank key="p">No ports yet</Blank>;
  const facts: [string, ReactNode][] = [
    ["Customer", core.customer ?? notApplicable],
    ["Reserved by", reservedBy],
    ["Ports", ports],
    ["Planned date", core.planned_date ?? notApplicable],
    ["Calculated loss", calc == null ? <Blank key="cl">No distance</Blank> : db(calc)],
    ["Measured loss", measuredLoss(loss)],
  ];
  return (
    <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 border-t pt-4 text-body">
      {facts.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReservationActions({ core, drawer }: { core: Core; drawer: Drawer }) {
  const holder = drawer.holder;
  if (!holder || !(drawer.canRequestRelease || drawer.canRelease)) {
    return null;
  }
  const reservationId = holder.reservation_id;
  const keep = () => drawer.act(() => resAction(reservationId, "keep"));
  const requestRelease = () => drawer.act(() => resAction(reservationId, "request-release", { cores: [core.id] }));
  const release = () => drawer.act(() => releaseRequestedCores(reservationId));
  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
      {drawer.canKeep && <button type="button" className="btn" disabled={drawer.busy} onClick={keep}>Keep</button>}
      {drawer.canRequestRelease && (
        <button type="button" className="btn" disabled={drawer.busy} onClick={requestRelease}>
          Request release of core {core.number}
        </button>
      )}
      {drawer.canRelease && (
        <button type="button" className="btn btn-p" disabled={drawer.busy} onClick={release}>
          Release requested cores
        </button>
      )}
    </div>
  );
}

function LossTests({ loss }: { loss: CoreLoss }) {
  return (
    <>
      <h3 className="mt-5 border-t pt-4 text-sm font-semibold">Measured loss tests</h3>
      <ol className="mt-2 text-body" aria-label="Measured loss tests, newest first">
        {loss.history.map((test, i) => (
          <li key={i} className="border-b border-rule py-2 last:border-b-0">
            <span className="font-semibold">{db(test.loss_db)}</span>
            {testDetails([test.test_method, test.tested_on, test.field_team])}
          </li>
        ))}
      </ol>
    </>
  );
}

function CoreHistory({ items, admin }: { items: Item[] | null; admin: boolean }) {
  return (
    <>
      <h3 className="mt-5 border-t pt-4 text-sm font-semibold">History</h3>
      <HistoryList items={items} admin={admin} />
    </>
  );
}

function HistoryList({ items, admin }: { items: Item[] | null; admin: boolean }) {
  if (!items) {
    return <p className="mt-2 text-body text-muted-foreground">Loading…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="mt-2 text-body text-muted-foreground">
        No events on this core{admin ? "" : " that you can see"}.
      </p>
    );
  }
  return (
    <ol className="mt-2 text-body" aria-label="Core history, newest first">
      {items.map((item, i) => (
        <li key={i} className="border-b border-rule py-2 last:border-b-0">
          <span className="font-semibold">{historyLine(item)}</span>
          {item.reservation_id != null && (
            <span className="text-muted-foreground"> (reservation #{item.reservation_id})</span>
          )}
          <span className="block text-muted-foreground">{when(item.at)}</span>
          {item.reason && <span className="block">Reason: {item.reason}</span>}
        </li>
      ))}
    </ol>
  );
}

// The drawer for one core of the open segment, with that core's loss row (or the segment's formula).
export function CoreDrawerForSegment({ inventory, detail, coreId, me, onChanged }: {
  inventory: Inventory;
  detail: Detail;
  coreId: number;
  me: Me;
  onChanged: () => void;
}) {
  const core = detail.cores.find((each) => each.id === coreId)!;
  const segmentLoss = inventory.segmentLoss;
  const coreLoss = segmentLoss?.cores.find((row) => row.core_id === coreId) ?? null;
  const calculated = coreLoss?.calculated_db ?? segmentLoss?.calculated_db ?? null;
  return (
    <CoreDrawer key={coreId} core={core} segment={segmentName(detail)} ends={[detail.site_a, detail.site_b]}
      me={me} onClose={() => inventory.setDrawerCore(null)} onChanged={onChanged} loss={coreLoss}
      calc={calculated} />
  );
}
