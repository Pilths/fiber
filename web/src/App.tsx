import { useState } from "react";
import { ChangePassword, Login } from "@/components/Auth";
import { EditSiteDialog, EditSegmentDialog } from "@/components/AdminEdit";
import { AssignDialog } from "@/components/AssignDialog";
import { CoreDrawerForSegment } from "@/components/CoreDrawer";
import type { SearchResult } from "@/components/GlobalSearch";
import { Header } from "@/components/Header";
import { InventoryView } from "@/components/InventoryView";
import { Approvals } from "@/components/reservations/Approvals";
import { MyReservations } from "@/components/reservations/MyReservations";
import { ReserveBox } from "@/components/ReserveBox";
import { Upload } from "@/components/Upload";
import { Users } from "@/components/Users";
import { useAuthGate, type Me } from "@/lib/useAuthGate";
import { useCustomerHighlight } from "@/lib/useCustomerHighlight";
import { useDashboardView } from "@/lib/useDashboardView";
import { adminActions, useEditDialogs } from "@/lib/useEditDialogs";
import { useInventory, type Inventory } from "@/lib/useInventory";
import type { RouteLeg } from "@/lib/useReserveBox";

const ERROR_CLASS = "rounded-md border border-red bg-red-bg px-4 py-2 font-semibold text-red";

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
  const customerMode = useCustomerHighlight(inventory.found != null, inventory.setError);
  const isAdmin = me.role === "admin";
  const { view, refreshBell } = dashboard;
  const { detail, segmentId } = inventory;
  const [clusterFocus, setClusterFocus] = useState<{ name: string } | null>(null);

  const changed = () => {
    setVersion((current) => current + 1);
    refreshBell();
  };
  const onPick = (result: SearchResult) => {
    if (result.type === "cluster") {
      dashboard.setView("map");
      setClusterFocus({ name: result.label });
      return;
    }
    if (result.segment_id == null) {
      return;
    }
    dashboard.setView("map");
    if (result.type === "customer" && result.customer_id != null) {
      inventory.clearSelection();
      customerMode.show(result.customer_id);
      return;
    }
    customerMode.clear();
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
            <MyReservations me={me} onChanged={refreshBell} />
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
          onAssign={dialogs.setAssign} customer={customerMode.customer} onClearCustomer={customerMode.clear}
          onPickRequest={customerMode.pickRequest} clusterFocus={clusterFocus}
          onClusterFocused={() => setClusterFocus(null)} />
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
