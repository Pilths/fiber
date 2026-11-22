import { MapFilters } from "@/components/FindCard";
import { CustomerChip } from "@/components/MapOverlay";
import { MapFilterPanel } from "@/components/MapPanels";
import { NetworkMap } from "@/components/NetworkMap";
import { RouteSearch } from "@/components/RoutePlanner";
import { SegmentPanel } from "@/components/SegmentPanel";
import { inFilter } from "@/lib/status";
import type { Me } from "@/lib/useAuthGate";
import type { CustomerHighlight } from "@/lib/useCustomerHighlight";
import type { AdminActions, Assignable } from "@/lib/useEditDialogs";
import type { Inventory } from "@/lib/useInventory";
import { useNetworkMap } from "@/lib/useNetworkMap";

// The map row ends one gutter above the window: 100vh minus the 60px header, main's 24px top padding and a
// 16px gutter. The floor keeps the Site A to B panel usable on short windows, the ceiling stops tall ones stretching.
const MAP_CARD_CLASS = "card col-span-8 flex min-h-[clamp(600px,calc(100vh-100px),1000px)] flex-col p-3";

// Customer mode selects all the customer's segments (plus a segment opened from the map) and fits to them.
function mapSelection(inventory: Inventory, customer: CustomerHighlight | null) {
  const found = inventory.found;
  if (found) {
    return { selectedIds: inventory.mapIds, routeKey: `found-${found.ids.join(",")}` };
  }
  if (!customer) {
    return { selectedIds: inventory.mapIds, routeKey: null };
  }
  const selectedIds = [...new Set([...customer.used.keys(), ...inventory.mapIds])];
  return { selectedIds, routeKey: `customer-${customer.id}` };
}

export function InventoryView(props: {
  me: Me;
  inventory: Inventory;
  admin: AdminActions | null;
  version: number;
  onAssign: (hold: Assignable) => void;
  customer: CustomerHighlight | null;
  onClearCustomer: () => void;
  onPickRequest: (requestId: number | null) => void;
}) {
  const { me, inventory, admin, version, onAssign, customer, onClearCustomer, onPickRequest } = props;
  const { optionIds, detail, segmentId } = inventory;
  const { selectedIds, routeKey } = mapSelection(inventory, customer);
  const clearMap = () => {
    inventory.clearSelection();
    onClearCustomer();
  };
  // The map state lives here so the map filters can sit in the Site A to B panel.
  const map = useNetworkMap({
    selectedIds,
    routeKey,
    version,
    onSelectSegment: inventory.pickOnMap,
    onClear: clearMap,
  });
  // A route's options show only their segments; otherwise the Region filter decides.
  const visible = (properties: { segment_id: number; region: string | null }) => {
    if (optionIds) {
      return optionIds.has(properties.segment_id);
    }
    return inFilter(properties, inventory.filter);
  };
  const tools = customer && (
    <CustomerChip customer={customer} onPickRequest={onPickRequest} onClear={onClearCustomer} />
  );
  const region = (
    <MapFilters segments={inventory.segments} filter={inventory.filter} onFilter={inventory.changeFilter} />
  );
  return (
    <main className="grid grid-cols-12 gap-4 px-6 pt-6 pb-4">
      <section className={MAP_CARD_CLASS} aria-label="Network map" aria-describedby="map-instr">
        <NetworkMap state={map} onClear={clearMap}
          customer={customer} onEmptyClick={customer ? clearMap : undefined}
          visible={visible}
          tools={tools} />
      </section>
      {/* The panel fills the map card's height (absolute, scrolls inside),
          so the map alone sets the row height. */}
      <div className="relative col-span-4 min-w-0">
        <RouteSearch planner={inventory.planner} filters={<MapFilterPanel state={map} region={region} />} />
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
