import { CoresTable } from "@/components/CoresTable";
import { SegmentDiagram } from "@/components/NetworkDetail";
import type { Me } from "@/lib/useAuthGate";
import type { AdminActions, Assignable } from "@/lib/useEditDialogs";
import type { Detail, Inventory } from "@/lib/useInventory";

const SENT_CLASS =
  "mb-3 flex items-center gap-3 rounded-md border border-green-bd bg-green-bg px-3 py-2 " +
  "text-body font-semibold text-green";

type SegmentPanelProps = {
  me: Me;
  inventory: Inventory;
  detail: Detail;
  admin: AdminActions | null;
  onAssign: (hold: Assignable) => void;
};

// The open segment under the map: its diagram, the action row and the Cores table.
export function SegmentPanel({ me, inventory, detail, admin, onAssign }: SegmentPanelProps) {
  const segmentId = inventory.segmentId;
  return (
    <div className="col-span-12 space-y-4 aria-busy:pointer-events-none aria-busy:opacity-60"
      aria-busy={detail.id !== segmentId}>
      <SegmentDiagram segments={inventory.segments} found={inventory.found} detail={detail}
        selectedId={segmentId ?? detail.id} onPick={(id) => inventory.open(id)} onSite={admin?.onEditSite} />
      <SegmentActions inventory={inventory} detail={detail} admin={admin} />
      <section id="cores" className="card scroll-mt-4" aria-labelledby="cores-h">
        <div className="card-h items-center"><h2 id="cores-h">Cores</h2></div>
        {inventory.sent != null && <Sent id={inventory.sent} onClose={() => inventory.setSent(null)} />}
        {detail.survey_cores == null ? (
          <NotSurveyed detail={detail} admin={admin} />
        ) : (
          <CoresTable key={`${detail.id}-${inventory.focusCoreId}`} detail={detail}
            focusCoreId={inventory.focusCoreId}
            flash={inventory.sent} onOpen={(core) => inventory.setDrawerCore(core.id)}
            onAssign={me.role === "admin" ? onAssign : null} />
        )}
      </section>
    </div>
  );
}

// Actions sit in their own row under the diagram, one fixed width so they line up.
function SegmentActions({ inventory, detail, admin }: Omit<SegmentPanelProps, "me" | "onAssign">) {
  const onRoute = inventory.onRoute;
  if (!onRoute && !admin) {
    return null;
  }
  return (
    <div className="flex justify-end gap-3 *:w-52 *:justify-center" data-testid="segment-actions">
      {onRoute && (
        <button type="button" className="btn btn-p" disabled={onRoute.insufficient}
          onClick={() => inventory.setReserving(true)}>
          Reserve on this route
        </button>
      )}
      {admin && detail.fiber_cut && (
        <button type="button" className="btn" onClick={() => admin.onEditSegment("restore")}>
          Restore
        </button>
      )}
      {admin && (
        <button type="button" className="btn" onClick={() => admin.onEditSegment()}>Edit segment</button>
      )}
    </div>
  );
}

// Closable success box above the Cores table after a request.
function Sent({ id, onClose }: { id: number; onClose: () => void }) {
  return (
    <div role="status" className={SENT_CLASS} data-testid="request-sent">
      <span className="flex-1">Request #{id} sent. Waiting for admin approval.</span>
      <button type="button" className="btn btn-sm px-2.5" aria-label="Close" onClick={onClose}>×</button>
    </div>
  );
}

function NotSurveyed({ detail, admin }: { detail: Detail; admin: AdminActions | null }) {
  return (
    <div role="status" data-testid="capacity" className="flex items-center gap-3 text-body">
      <p>Not verified, cannot be booked. Total cores {detail.cable_size}.</p>
      {admin && (
        <button type="button" className="btn btn-sm" onClick={() => admin.onEditSegment("survey")}>
          Enter verified cores
        </button>
      )}
    </div>
  );
}
