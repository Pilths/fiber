import { useState } from "react";
import { api } from "@/api/client";
import { ChangePassword, Login } from "@/components/Auth";
import { EditSiteDialog, EditSegmentDialog, type SegmentFocus } from "@/components/AdminEdit";
import { AssignDialog } from "@/components/AssignDialog";
import { CoreDrawer } from "@/components/CoreDrawer";
import { MapFilters } from "@/components/FindCard";
import { Header } from "@/components/Header";
import { CoresTable, SegmentDiagram } from "@/components/NetworkDetail";
import { NetworkMap } from "@/components/NetworkMap";
import { Approvals, MyReservations, NeedsReview } from "@/components/Reservations";
import { ReserveBox } from "@/components/ReserveBox";
import { RouteSearch } from "@/components/RoutePlanner";
import { Upload } from "@/components/Upload";
import { Users } from "@/components/Users";
import { inFilter, segmentName } from "@/lib/status";
import { useAuthGate, type Me } from "@/lib/useAuthGate";
import { useDashboardView } from "@/lib/useDashboardView";
import { useInventory, type Detail, type Inventory } from "@/lib/useInventory";
import type { RouteLeg } from "@/lib/useReserveBox";

const ERROR_CLASS = "rounded-md border border-red bg-red-bg px-4 py-2 font-semibold text-red";
const SENT_CLASS =
  "mb-3 flex items-center gap-3 rounded-md border border-green-bd bg-green-bg px-3 py-2 " +
  "text-body font-semibold text-green";

type AdminActions = {
  onEditSegment: (focus?: SegmentFocus) => void;
  onEditSite: (end: "a" | "b") => void;
};
type Assignable = Detail["unassigned"][number];

export default function App() {
  const auth = useAuthGate();
  if (auth.page === "loading") {
    return null;
  }
  if (auth.page === "error") {
    return (
      <p role="alert" className={`m-6 ${ERROR_CLASS}`}>Could not reach the server. Reload to try again.</p>
    );
  }
  if (auth.page === "login" || !auth.me) {
    return <Login onSignedIn={auth.signedIn} />;
  }
  if (auth.page === "change" || auth.voluntary) {
    return (
      <ChangePassword me={auth.me} forced={auth.page === "change"} onSignOut={auth.signOut}
        onCancel={auth.cancelChangePassword} onDone={auth.passwordChanged} />
    );
  }
  return <Dashboard me={auth.me} onSignOut={auth.signOut} onChangePassword={auth.openChangePassword} />;
}

// Edit dialogs opened from Inventory (admins only).
function useEditDialogs() {
  const [editSegment, setEditSegment] = useState<{ focus?: SegmentFocus } | null>(null);
  const [editSite, setEditSite] = useState<number | null>(null);
  const [assign, setAssign] = useState<Assignable | null>(null);
  return { editSegment, setEditSegment, editSite, setEditSite, assign, setAssign };
}

function adminActions(
  me: Me,
  inventory: Inventory,
  dialogs: ReturnType<typeof useEditDialogs>,
): AdminActions | null {
  const segmentId = inventory.segmentId;
  if (me.role !== "admin" || segmentId == null) {
    return null;
  }
  const onEditSite = async (end: "a" | "b") => {
    try {
      const segment = await api.get("/api/admin/segments/{sid}", { path: { sid: segmentId } });
      dialogs.setEditSite(end === "a" ? segment.site_a_id : segment.site_b_id);
    } catch {
      inventory.setError("Could not load the segment.");
    }
  };
  return { onEditSegment: (focus?: SegmentFocus) => dialogs.setEditSegment({ focus }), onEditSite };
}

function routeLegs(inventory: Inventory): RouteLeg[] {
  const found = inventory.found!;
  return inventory.option!.segments.map((segment, i) => ({
    segment_id: segment.segment_id,
    free: segment.free_to_reserve,
    a: found.sites[i],
    b: found.sites[i + 1],
    km: segment.km,
  }));
}

type DashboardProps = { me: Me; onSignOut: () => void; onChangePassword: () => void };

function Dashboard({ me, onSignOut, onChangePassword }: DashboardProps) {
  // bumped after a booking or edit so the segment list and grid reload
  const [version, setVersion] = useState(0);
  const dashboard = useDashboardView();
  const inventory = useInventory(dashboard.view, version);
  const dialogs = useEditDialogs();
  const admin = adminActions(me, inventory, dialogs);
  const isAdmin = me.role === "admin";
  const { view, refreshBell } = dashboard;
  const { detail, segmentId } = inventory;

  const changed = () => {
    setVersion((current) => current + 1);
    refreshBell();
  };
  const onPick = (result: { segment_id?: number | null; core_id?: number | null }) => {
    if (result.segment_id == null) {
      return;
    }
    dashboard.setView("map");
    inventory.openFromSearch(result.segment_id, result.core_id ?? null);
  };
  const drawn = detail?.cores.find((core) => core.id === inventory.drawerCore);
  const showUpload = isAdmin && (dashboard.uploadSeen || view === "upload");

  return (
    <div className="min-h-screen">
      <Header onPick={onPick} view={view} onView={dashboard.setView} me={me}
        approvals={isAdmin ? dashboard.bell?.approvals ?? null : null} stale={dashboard.stale}
        onSignOut={onSignOut} onChangePassword={onChangePassword} />
      {inventory.error && <p role="alert" className={`mx-6 mt-4 ${ERROR_CLASS}`}>{inventory.error}</p>}
      {view !== "map" && view !== "upload" && (
        <main className="space-y-4 px-6 pt-6 pb-10">
          {view === "mine" && (
            <>
              <MyReservations me={me} onChanged={refreshBell} />
              <NeedsReview me={me} onChanged={refreshBell} />
            </>
          )}
          {view === "approvals" && <Approvals me={me} onChanged={refreshBell} />}
          {view === "users" && <Users me={me} />}
        </main>
      )}
      {showUpload && (
        <main hidden={view !== "upload"} className="space-y-4 px-6 pt-6 pb-10"><Upload /></main>
      )}
      {view === "map" && (
        <InventoryView me={me} inventory={inventory} admin={admin} version={version}
          onAssign={dialogs.setAssign} />
      )}
      {detail && drawn && (
        <CoreDrawerForSegment inventory={inventory} detail={detail} coreId={drawn.id} me={me}
          onChanged={changed} />
      )}
      {inventory.reserving && inventory.option && inventory.found && (
        <ReserveBox sites={inventory.found.sites} legs={routeLegs(inventory)}
          need={inventory.planner.need ?? 1}
          onClose={() => inventory.setReserving(false)}
          onSent={(id) => {
            inventory.setSent(id);
            changed();
          }} />
      )}
      {dialogs.editSegment && segmentId != null && (
        <EditSegmentDialog segmentId={segmentId} focus={dialogs.editSegment.focus}
          onClose={() => dialogs.setEditSegment(null)} onSaved={changed} />
      )}
      {dialogs.assign && detail && (
        <AssignDialog d={detail} hold={dialogs.assign} onClose={() => dialogs.setAssign(null)}
          onSaved={changed} />
      )}
      {dialogs.editSite != null && (
        <EditSiteDialog siteId={dialogs.editSite} onClose={() => dialogs.setEditSite(null)}
          onSaved={changed} />
      )}
    </div>
  );
}

function CoreDrawerForSegment({ inventory, detail, coreId, me, onChanged }: {
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
      me={me}
      onClose={() => inventory.setDrawerCore(null)} onChanged={onChanged} loss={coreLoss} calc={calculated} />
  );
}

function InventoryView({ me, inventory, admin, version, onAssign }: {
  me: Me;
  inventory: Inventory;
  admin: AdminActions | null;
  version: number;
  onAssign: (hold: Assignable) => void;
}) {
  const { found, optionIds, detail, segmentId } = inventory;
  const routeKey = found ? `found-${found.ids.join(",")}` : null;
  const filters = (
    <MapFilters segments={inventory.segments} filter={inventory.filter} onFilter={inventory.changeFilter} />
  );
  return (
    <main className="grid grid-cols-12 gap-4 px-6 pt-6 pb-10">
      <section className="card col-span-8 flex flex-col p-3" aria-label="Network map"
        aria-describedby="map-instr">
        {/* ponytail: site clicks do nothing on the view-only map; wire them to Site A/B if planners ask */}
        <NetworkMap version={version} onSelectSegment={inventory.pickOnMap} onSite={() => {}}
          onClear={inventory.clearSelection} selectedIds={inventory.mapIds} routeKey={routeKey}
          visible={(properties) => {
            if (optionIds) {
              return optionIds.has(properties.segment_id);
            }
            return inFilter(properties, inventory.filter);
          }}
          tools={filters} />
      </section>
      {/* The panel fills the map card's height (absolute, scrolls inside),
          so the map alone sets the row height. */}
      <div className="relative col-span-4 min-w-0">
        <RouteSearch planner={inventory.planner} />
      </div>
      {segmentId != null && !detail && (
        <p className="card empty col-span-12 text-center text-body text-muted-foreground">
          Loading segment...
        </p>
      )}
      {detail && (
        <SegmentPanel me={me} inventory={inventory} detail={detail} admin={admin} onAssign={onAssign} />
      )}
    </main>
  );
}

function SegmentPanel({ me, inventory, detail, admin, onAssign }: {
  me: Me;
  inventory: Inventory;
  detail: Detail;
  admin: AdminActions | null;
  onAssign: (hold: Assignable) => void;
}) {
  const segmentId = inventory.segmentId;
  const onRoute = inventory.onRoute;
  return (
    <div className="col-span-12 space-y-4 aria-busy:pointer-events-none aria-busy:opacity-60"
      aria-busy={detail.id !== segmentId}>
      <SegmentDiagram segments={inventory.segments} found={inventory.found} d={detail}
        selectedId={segmentId ?? detail.id} onPick={(id) => inventory.open(id)} onSite={admin?.onEditSite} />
      {/* Actions sit in their own row under the diagram, one fixed width so they line up. */}
      {(onRoute || admin) && (
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
      )}
      <section id="cores" className="card scroll-mt-4" aria-labelledby="cores-h">
        <div className="card-h items-center"><h2 id="cores-h">Cores</h2></div>
        {inventory.sent != null && <Sent id={inventory.sent} onClose={() => inventory.setSent(null)} />}
        {detail.survey_cores == null ? (
          <NotSurveyed detail={detail} admin={admin} />
        ) : (
          <CoresTable key={`${detail.id}-${inventory.focusCoreId}`} d={detail}
            focusCoreId={inventory.focusCoreId}
            flash={inventory.sent} onOpen={(core) => inventory.setDrawerCore(core.id)}
            onAssign={me.role === "admin" ? onAssign : null} />
        )}
      </section>
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
  let message = "Not surveyed, cannot be booked.";
  if (admin) {
    message = "Not surveyed: enter a survey count to make it bookable.";
  }
  return (
    <div role="status" data-testid="capacity" className="flex items-center gap-3 text-body">
      <p>{message} No cores to show. Cable size {detail.cable_size}.</p>
      {admin && (
        <button type="button" className="btn btn-sm" onClick={() => admin.onEditSegment("survey")}>
          Enter survey count
        </button>
      )}
    </div>
  );
}
