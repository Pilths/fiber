import { Fragment, useEffect, useId, useRef } from "react";
import { CustomerField, SimilarWarning } from "@/components/CustomerPicker";
import { Blank } from "@/components/LossCard";
import { Chain } from "@/components/NetworkDetail";
import { Dialog } from "@/components/upload-parts";
import { db } from "@/lib/status";
import {
  availableCores,
  useReserveBox,
  type Core,
  type LossDetail,
  type ReserveBoxState,
  type RouteLeg,
} from "@/lib/useReserveBox";

const DIALOG_CLASS =
  "m-auto flex max-h-[640px] w-[1040px] max-w-[calc(100vw-32px)] flex-col overflow-visible " +
  "rounded-lg border bg-white p-0 text-sm backdrop:bg-[#0a0a0a]/45";
const TITLE_CLASS = "flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold";
const ERROR_CLASS = "mb-3 rounded-md border border-red bg-red-bg px-3 py-2 text-body font-semibold text-red";
const EMPTY_CLASS = "empty pb-4 text-body text-muted-foreground";

function coresText(count: number): string {
  return `${count} ${count === 1 ? "core" : "cores"}`;
}

// The modal opens itself; focus returns to the opener (the "Reserve on this route" button).
// The opener is kept from the first mount: StrictMode mounts twice.
function useModal(dialog: React.RefObject<HTMLDialogElement | null>) {
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current ??= document.activeElement;
    const element = dialog.current!;
    if (!element.open) {
      element.showModal();
    }
    return () => {
      element.close();
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [dialog]);
}

function RouteTitle({ id, sites }: { id: string; sites: string[] }) {
  return (
    <h2 id={id} className={TITLE_CLASS}>
      <span className="sr-only">Reserve on </span>
      {sites.map((site, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span aria-hidden className="flex items-center gap-1 text-blue">
              ●<span className="h-0.5 w-6 bg-blue" />
            </span>
          )}
          {i > 0 && <span className="sr-only">to</span>}
          <span className="truncate">{site}</span>
        </Fragment>
      ))}
    </h2>
  );
}

function LegBadge({ chosen, perSegment }: { chosen: number; perSegment: number }) {
  const full = chosen === perSegment;
  return (
    <span className={`pill min-w-11 justify-center ${full ? "h-green" : "h-amber"}`} data-testid="leg-count">
      {chosen} of {perSegment}
    </span>
  );
}

function CoresNeeded({ id, box }: { id: string; box: ReserveBoxState }) {
  const labelId = `${id}-n`;
  return (
    <div className="mb-3 flex items-center gap-3">
      <span id={labelId} className="font-semibold">Cores needed per segment</span>
      <div role="group" aria-labelledby={labelId} className="flex items-center gap-1">
        <button type="button" className="btn btn-sm w-8 px-0" aria-label="One fewer"
          disabled={box.perSegment <= 1}
          onClick={() => box.step(box.perSegment - 1)}>−</button>
        <output aria-live="polite" className="w-10 text-center text-base font-semibold tabular-nums"
          data-testid="reserve-n">{box.perSegment}</output>
        <button type="button" className="btn btn-sm w-8 px-0" aria-label="One more"
          disabled={box.perSegment >= box.max}
          onClick={() => box.step(box.perSegment + 1)}>+</button>
      </div>
    </div>
  );
}

function PickedSegmentCores({ box }: { box: ReserveBoxState }) {
  if (box.picked == null) {
    return <p className={EMPTY_CLASS}>Choose a segment</p>;
  }
  if (!box.shown) {
    return <p className={EMPTY_CLASS}>Loading cores...</p>;
  }
  return (
    <CoreList available={availableCores(box.shown.cores)} loss={box.shown.loss} ticked={box.ticked}
      full={box.chosenOn(box.picked) >= box.perSegment} toggle={box.toggle} />
  );
}

function BookingFields({ box }: { box: ReserveBoxState }) {
  const customerMissing = box.tried && !box.customerPicker.customer;
  return (
    <div className="border-t px-5 py-4">
      {box.error && <p role="alert" className={ERROR_CLASS}>{box.error}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <CustomerField picker={box.customerPicker} />
        <label className="grid w-[170px] gap-1">
          <span className="lbl">Planned date</span>
          <input type="date" className="field" value={box.date}
            onChange={(event) => box.setDate(event.target.value)} />
        </label>
        <label className="grid w-[150px] gap-1">
          <span className="lbl">SRF ID (optional)</span>
          <input className="field" value={box.srf} onChange={(event) => box.setSrf(event.target.value)}
            autoComplete="off" />
        </label>
        <button type="submit" className="btn btn-p ml-auto min-w-[150px]" disabled={box.busy || !box.ready}>
          {`Reserve ${coresText(box.ticked.size)}`}
        </button>
      </div>
      <SimilarWarning picker={box.customerPicker} />
      {customerMissing && (
        <p role="alert" className="mt-2.5 text-body font-bold text-red">
          Choose a customer before submitting.
        </p>
      )}
    </div>
  );
}

type DiscardDialogProps = { count: number; onKeep: () => void; onDiscard: () => void };

function DiscardDialog({ count, onKeep, onDiscard }: DiscardDialogProps) {
  return (
    <Dialog title={`Discard ${count} chosen ${count === 1 ? "core" : "cores"}?`} onClose={onKeep}>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onKeep}>Keep editing</button>
        <button type="button" className="btn btn-p" onClick={onDiscard}>Discard</button>
      </div>
    </Dialog>
  );
}

// Reserve box: a modal over Inventory for a found route (one segment is a route between its two sites).
export function ReserveBox({ sites, legs, need, onClose, onSent }: {
  sites: string[]; // the chain in travel order
  legs: RouteLeg[];
  need: number;
  onClose: () => void;
  onSent: (reservationId: number) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useModal(dialog);
  const box = useReserveBox(legs, need, onClose, onSent);

  const onCancel = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!box.asking) {
      box.close();
    }
  };
  const chainLegs = legs.map((leg) => ({ id: leg.segment_id, a: leg.a, b: leg.b, km: leg.km }));
  return (
    <dialog ref={dialog} aria-labelledby={`${id}-h`} data-testid="reserve-box" onCancel={onCancel}
      className={DIALOG_CLASS}>
      <header className="flex items-center gap-4 border-b px-5 py-3">
        <RouteTitle id={`${id}-h`} sites={sites} />
        <button type="button" className="btn btn-sm px-2.5" aria-label="Close" onClick={box.close}>×</button>
      </header>

      <form onSubmit={box.submit} noValidate aria-label="Reserve cores"
        className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-5 pt-4 pb-2" data-testid="route-chain">
          <Chain legs={chainLegs} selectedId={box.picked} onPick={box.pick} onUnpick={box.unpick}
            describe={(segmentId) => `${box.chosenOn(segmentId)} of ${box.perSegment} cores chosen`}
            badge={(segmentId) => (
              <LegBadge chosen={box.chosenOn(segmentId)} perSegment={box.perSegment} />
            )} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">
          <CoresNeeded id={id} box={box} />
          <PickedSegmentCores box={box} />
        </div>
        <BookingFields box={box} />
      </form>

      {box.asking && (
        <DiscardDialog count={box.ticked.size} onKeep={() => box.setAsking(false)} onDiscard={onClose} />
      )}
    </dialog>
  );
}

function PortsCell({ core }: { core: Core }) {
  if (!core.port_a && !core.port_b) {
    return <Blank>-</Blank>;
  }
  return <>{`${core.port_a ?? "-"} → ${core.port_b ?? "-"}`}</>;
}

type MeasuredCellProps = { measured: number | null | undefined; calculated: number | null };

function MeasuredCell({ measured, calculated }: MeasuredCellProps) {
  if (measured == null) {
    return <Blank>Not tested</Blank>;
  }
  const high = calculated != null && measured > calculated;
  if (!high) {
    return <>{db(measured)}</>;
  }
  return (
    <>
      {db(measured)} <span aria-hidden className="text-amber">▲</span>
      <span className="sr-only"> above calculated</span>
    </>
  );
}

// Available cores of one segment: tick, core, ports, Calculated loss, Measured loss.
// Unticked rows lock once full.
function CoreList({ available, loss, ticked, full, toggle }: {
  available: Core[];
  loss: LossDetail | null;
  ticked: Set<number>;
  full: boolean;
  toggle: (id: number) => void;
}) {
  const lossOf = (core: Core) => loss?.cores.find((row) => row.core_id === core.id);
  // The core's own calculated loss when it has a loss row, else the segment's (same formula per segment).
  const calculatedOf = (core: Core) => lossOf(core)?.calculated_db ?? loss?.calculated_db ?? null;
  return (
    <table className="tbl [&_td]:h-9 [&_th]:h-9">
      <caption className="sr-only">Available cores</caption>
      <thead className="sticky top-0 bg-white">
        <tr>
          <th scope="col" className="w-12"><span className="sr-only">Chosen</span></th>
          <th scope="col" className="w-[14%]">Core</th>
          <th scope="col">Ports</th>
          <th scope="col" className="num w-[20%]">Calculated loss</th>
          <th scope="col" className="num w-[20%]">Measured loss</th>
        </tr>
      </thead>
      <tbody>
        {available.map((core) => {
          const chosen = ticked.has(core.id);
          const calculated = calculatedOf(core);
          return (
            <tr key={core.id} className={chosen ? "bg-blue-bg" : ""} data-core={core.number}>
              <td>
                <input type="checkbox" className="size-4 accent-blue" aria-label={`Core ${core.number}`}
                  checked={chosen} disabled={!chosen && full} onChange={() => toggle(core.id)} />
              </td>
              <th scope="row" className="font-semibold">{core.number}</th>
              <td className="truncate"><PortsCell core={core} /></td>
              <td className="num">{calculated == null ? <Blank>-</Blank> : db(calculated)}</td>
              <td className="num">
                <MeasuredCell measured={lossOf(core)?.measured_db} calculated={calculated} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
