import { useState } from "react";
import { api } from "@/api/client";
import type { SegmentFocus } from "@/components/AdminEdit";
import type { Me } from "@/lib/useAuthGate";
import type { Detail, Inventory } from "@/lib/useInventory";

export type AdminActions = {
  onEditSegment: (focus?: SegmentFocus) => void;
  onEditSite: (end: "a" | "b") => void;
};
export type Assignable = Detail["unassigned"][number];

// Edit dialogs opened from Inventory (admins only).
export function useEditDialogs() {
  const [editSegment, setEditSegment] = useState<{ focus?: SegmentFocus } | null>(null);
  const [editSite, setEditSite] = useState<number | null>(null);
  const [assign, setAssign] = useState<Assignable | null>(null);
  return { editSegment, setEditSegment, editSite, setEditSite, assign, setAssign };
}

export function adminActions(
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
