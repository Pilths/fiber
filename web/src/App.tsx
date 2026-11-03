import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, authEvents, setDevUser } from "@/api/client";
import { ChangePassword, Login } from "@/components/Auth";
import type { components } from "@/api/schema";
import { EditSiteDialog, EditSegmentDialog, type SegmentFocus } from "@/components/AdminEdit";
import { CoreDrawer } from "@/components/CoreDrawer";
import { MapFilters } from "@/components/FindCard";
import { Header, type View } from "@/components/Header";
import { AssignDialog } from "@/components/AssignDialog";
import { CoresTable, SegmentDiagram, type Found } from "@/components/NetworkDetail";
import { NetworkMap } from "@/components/NetworkMap";
import { ReserveBox } from "@/components/ReserveBox";
import { RouteSearch, useRoutePlanner } from "@/components/RoutePlanner";
import { Upload } from "@/components/Upload";
import { Users } from "@/components/Users";
import { Approvals, MyReservations, NeedsReview } from "@/components/Reservations";
import { inFilter, NO_FILTER, segmentName, type LossDetail, type SegmentFilter } from "@/lib/status";

type Segment = components["schemas"]["SegmentSummary"];
type Detail = components["schemas"]["SegmentDetail"];
type Me = components["schemas"]["CurrentUser"];
type Bell = components["schemas"]["Bell"];

// Selection lives in the URL hash so links can be shared: #segment=<site A> - <site B>.
// The API has no LRD codes on segments yet, so the hash uses the segment name, not the AABB-BBCC form of the PRD.
// A found route uses #route=<from site id>-<to site id>-<cores>-<km|free_cores>-<option index> (RoutePlanner.tsx).
const hashSegment = () => {
  // Old links used #span=: rewrite them to #segment= in place.
  if (location.hash.startsWith("#span=")) history.replaceState(null, "", "#segment=" + location.hash.slice(6));
  const m = /^#segment=(.+)$/.exec(location.hash);
  try { return m ? decodeURIComponent(m[1]) : null; } catch { return null; }
};

// Auth gate: GET /api/me decides. 401 -> Login, must_change_password -> Change password, else the dashboard.
// The api client reports a 401 or a 403 password_change_required from any call, so a mid-session change routes too.
export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [page, setPage] = useState<"loading" | "login" | "change" | "app" | "error">("loading");
  const [voluntary, setVoluntary] = useState(false);

  const loadMe = useCallback(() => {
    api.get("/api/me")
      .then((u) => { setMe(u); setPage(u.must_change_password ? "change" : "app"); })
      .catch((e) => setPage(e instanceof ApiError && e.status === 401 ? "login" : "error"));
  }, []);
  useEffect(() => {
    loadMe();
    const out = () => { setMe(null); setPage("login"); };
    const change = () => loadMe();
    authEvents.addEventListener("signed-out", out);
    authEvents.addEventListener("password-change", change);
    return () => { authEvents.removeEventListener("signed-out", out); authEvents.removeEventListener("password-change", change); };
  }, [loadMe]);

  const signOut = () => {
    setDevUser(null);
    api.post("/api/auth/logout").catch(() => {}).finally(() => { setMe(null); setPage("login"); });
  };

  if (page === "loading") return null;
  if (page === "error") return <p role="alert" className="m-6 rounded-md border border-red bg-red-bg px-4 py-2 font-semibold text-red">Could not reach the server. Reload to try again.</p>;
  if (page === "login" || !me) return <Login onSignedIn={(u) => { setDevUser(null); setMe(u); setVoluntary(false); setPage(u.must_change_password ? "change" : "app"); }} />;
  if (page === "change" || voluntary) {
    return <ChangePassword me={me} forced={page === "change"} onSignOut={signOut} onCancel={() => setVoluntary(false)}
      onDone={() => { setVoluntary(false); setPage("loading"); loadMe(); }} />;
  }
  return <Dashboard me={me} onSignOut={signOut} onChangePassword={() => setVoluntary(true)} />;
}

function Dashboard({ me, onSignOut, onChangePassword }: { me: Me; onSignOut: () => void; onChangePassword: () => void }) {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [segmentId, setSegmentId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [focusCoreId, setFocusCoreId] = useState<number | null>(null);
  const [reserving, setReserving] = useState(false);
  const [sent, setSent] = useState<number | null>(null); // reservation id of the last request: success box and highlighted row
  const [view, setViewState] = useState<View>(location.hash === "#users" ? "users" : "map");
  const [bell, setBell] = useState<Bell | null>(null);
  const [stale, setStale] = useState(0);
  const [loss, setLoss] = useState<LossDetail | null>(null);
  const [version, setVersion] = useState(0); // bumped after a booking or edit so the segment list and grid reload
  const [drawerCore, setDrawerCore] = useState<number | null>(null);
  const [editSegment, setEditSegment] = useState<{ focus?: SegmentFocus } | null>(null);
  const [editSite, setEditSite] = useState<number | null>(null);
  const [assign, setAssign] = useState<Detail["unassigned"][number] | null>(null);
  const [filter, setFilter] = useState<SegmentFilter>(NO_FILTER);
  // Site A to B beside the map; the chosen option is the found route, drawn on the map and the segment diagram.
  const rp = useRoutePlanner(view === "map", version);
  const op = rp.option;
  const found: Found | null = op && { ids: op.segments.map((s) => s.segment_id), km: op.total_km, sites: [op.segments[0].site_a, ...op.segments.map((s) => s.site_b)] };
  const foundKey = found?.ids.join(",");
  // Upload stays mounted once opened (hidden on other views) so a staged preview and its choices survive tab changes.
  const [uploadSeen, setUploadSeen] = useState(false);
  if (view === "upload" && !uploadSeen) setUploadSeen(true);

  const refreshBell = useCallback(() => {
    api.get("/api/bell").then(setBell).catch(() => {});
    api.get("/api/reservations", { query: { mine: true } }).then((r) => setStale(r.filter((x) => x.stale).length)).catch(() => {});
  }, []);
  // Users has its own URL (#users) so it can be visited directly; other views keep the #segment= hash.
  const setView = useCallback((v: View) => {
    setViewState(v);
    if (v === "users") history.replaceState(null, "", "#users");
    else if (location.hash === "#users" || (v !== "map" && location.hash.startsWith("#route="))) history.replaceState(null, "", location.pathname);
  }, []);
  useEffect(() => {
    const sync = () => {
      if (location.hash === "#users") setViewState("users");
      if (location.hash.startsWith("#route=")) setViewState("map");
    };
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, []);
  useEffect(refreshBell, [refreshBell, view]);

  useEffect(() => {
    api.get("/api/segments").then(setSegments).catch(() => setError("Could not load segments."));
  }, [version, view]);
  useEffect(() => {
    if (segmentId == null) return;
    let stale = false;
    api.get("/api/segments/{segment_id}", { path: { segment_id: segmentId } }).then((d) => !stale && setDetail(d)).catch(() => !stale && setError("Could not load the segment."));
    api.get("/api/loss/segments/{segment_id}", { path: { segment_id: segmentId } }).then((l) => !stale && setLoss(l)).catch(() => {});
    return () => { stale = true; };
  }, [segmentId, version]);

  const segmentRef = useRef(segmentId);
  useEffect(() => { segmentRef.current = segmentId; }, [segmentId]);
  // Selects a segment on Inventory.
  const open = useCallback((id: number, coreId: number | null = null) => {
    setDetail((d) => (d?.id === id ? d : null));
    setSegmentId(id);
    setFocusCoreId(coreId);
    setReserving(false);
    setSent(null);
    setDrawerCore(null);
  }, []);

  // Hash -> selection, on load and when the hash changes (back button, pasted link).
  useEffect(() => {
    if (!segments) return;
    const sync = () => {
      const name = hashSegment();
      const s = name && segments.find((x) => segmentName(x) === name);
      if (s && segmentRef.current !== s.id) open(s.id);
    };
    sync();
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, [segments, open]);
  // A newly found route (or another option) selects its first segment.
  const [seenRoute, setSeenRoute] = useState(foundKey);
  if (seenRoute !== foundKey) { setSeenRoute(foundKey); if (found) open(found.ids[0]); }
  // Selection -> hash; a found route keeps its #route= hash.
  useEffect(() => {
    const s = segments?.find((x) => x.id === segmentId);
    if (s && !foundKey && hashSegment() !== segmentName(s)) history.replaceState(null, "", `#segment=${encodeURIComponent(segmentName(s))}`);
  }, [segmentId, segments, foundKey]);

  const changed = () => { setVersion((v) => v + 1); refreshBell(); };
  const drawn = detail?.cores.find((c) => c.id === drawerCore);
  const admin = me.role === "admin" && segmentId != null ? {
    onEditSegment: (focus?: SegmentFocus) => setEditSegment({ focus }),
    onEditSite: (end: "a" | "b") => {
      api.get("/api/admin/segments/{sid}", { path: { sid: segmentId } }).then((x) => setEditSite(end === "a" ? x.site_a_id : x.site_b_id)).catch(() => setError("Could not load the segment."));
    },
  } : null;
  // Map: Esc clears the selection and the searched route.
  const clearSelection = () => {
    setSegmentId(null); setDetail(null); setDrawerCore(null); rp.clear();
    if (location.hash.startsWith("#segment=")) history.replaceState(null, "", location.pathname);
  };
  const mapIds = found ? [...found.ids, ...(segmentId != null && !found.ids.includes(segmentId) ? [segmentId] : [])]
    : segmentId != null ? [segmentId] : [];
  const segmentLoss = loss?.segment_id === segmentId ? loss : null;
  const onRoute = op && detail && found?.ids.includes(detail.id) ? op : null;

  return (
    <div className="min-h-screen">
      <Header onPick={(r) => { if (r.segment_id != null) { setView("map"); open(r.segment_id, r.core_id ?? null); } }} view={view} onView={setView} me={me}
        approvals={me.role === "admin" ? bell?.approvals ?? null : null} stale={stale} onSignOut={onSignOut} onChangePassword={onChangePassword} />
      {error && <p role="alert" className="mx-6 mt-4 rounded-md border border-red bg-red-bg px-4 py-2 font-semibold text-red">{error}</p>}
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
      {me.role === "admin" && (uploadSeen || view === "upload") && (
        <main hidden={view !== "upload"} className="space-y-4 px-6 pt-6 pb-10"><Upload /></main>
      )}
      {view === "map" && (
        <main className="grid grid-cols-12 gap-4 px-6 pt-6 pb-10">
          <section className="card col-span-8 flex flex-col p-3" aria-label="Network map" aria-describedby="map-instr">
            {/* ponytail: site clicks do nothing on the view-only map; wire them to Site A/B if planners ask */}
            <NetworkMap version={version} onSelectSegment={(id) => open(id)} onSite={() => {}} onClear={clearSelection}
              selectedIds={mapIds} routeKey={found ? `found-${found.ids.join(",")}` : null} visible={(p) => inFilter(p, filter)}
              tools={<MapFilters segments={segments} filter={filter} onFilter={setFilter} />} />
          </section>
          {/* The panel fills the map card's height (absolute, scrolls inside), so the map alone sets the row height. */}
          <div className="relative col-span-4 min-w-0">
            <RouteSearch rp={rp} />
          </div>
          {segmentId != null && !detail && <p className="card empty col-span-12 text-center text-body text-muted-foreground">Loading segment...</p>}
          {detail && (
            <div className="col-span-12 space-y-4">
              <SegmentDiagram segments={segments} found={found} d={detail} selectedId={detail.id} onPick={(id) => open(id)}
                onSite={admin?.onEditSite} />
              {/* Actions sit in their own row under the diagram, one fixed width so they line up. */}
              {(onRoute || admin) && (
                <div className="flex justify-end gap-3 *:w-52 *:justify-center" data-testid="segment-actions">
                  {onRoute && <button type="button" className="btn btn-p" disabled={onRoute.insufficient} onClick={() => setReserving(true)}>Reserve on this route</button>}
                  {admin && detail.fiber_cut && <button type="button" className="btn" onClick={() => admin.onEditSegment("restore")}>Restore</button>}
                  {admin && <button type="button" className="btn" onClick={() => admin.onEditSegment()}>Edit segment</button>}
                </div>
              )}
              <section id="cores" className="card scroll-mt-4" aria-labelledby="cores-h">
                <div className="card-h items-center"><h2 id="cores-h">Cores</h2></div>
                {sent != null && <Sent id={sent} onClose={() => setSent(null)} />}
                {detail.survey_cores == null
                  ? <NotSurveyed d={detail} admin={admin} />
                  : <CoresTable key={`${detail.id}-${focusCoreId}`} d={detail} focusCoreId={focusCoreId} flash={sent} onOpen={(c) => setDrawerCore(c.id)} onAssign={me.role === "admin" ? setAssign : null} />}
              </section>
            </div>
          )}
        </main>
      )}
      {detail && drawn && <CoreDrawer key={drawn.id} core={drawn} segment={segmentName(detail)} ends={[detail.site_a, detail.site_b]} me={me} onClose={() => setDrawerCore(null)} onChanged={changed}
        loss={segmentLoss?.cores.find((x) => x.core_id === drawn.id) ?? null} calc={segmentLoss?.cores.find((x) => x.core_id === drawn.id)?.calculated_db ?? segmentLoss?.calculated_db ?? null} />}
      {reserving && op && found && (
        <ReserveBox sites={found.sites} onClose={() => setReserving(false)} onSent={(id) => { setSent(id); changed(); }}
          need={rp.need ?? 1} legs={op.segments.map((s, i) => ({ segment_id: s.segment_id, free: s.free_to_reserve, a: found.sites[i], b: found.sites[i + 1], km: s.km }))} />
      )}
      {editSegment && segmentId != null && <EditSegmentDialog segmentId={segmentId} focus={editSegment.focus} onClose={() => setEditSegment(null)} onSaved={changed} />}
      {assign && detail && <AssignDialog d={detail} hold={assign} onClose={() => setAssign(null)} onSaved={changed} />}
      {editSite != null && <EditSiteDialog siteId={editSite} onClose={() => setEditSite(null)} onSaved={changed} />}
    </div>
  );
}

// Closable success box above the Cores table after a request.
const Sent = ({ id, onClose }: { id: number; onClose: () => void }) => (
  <div role="status" className="mb-3 flex items-center gap-3 rounded-md border border-green-bd bg-green-bg px-3 py-2 text-body font-semibold text-green" data-testid="request-sent">
    <span className="flex-1">Request #{id} sent. Waiting for admin approval.</span>
    <button type="button" className="btn btn-sm px-2.5" aria-label="Close" onClick={onClose}>×</button>
  </div>
);

function NotSurveyed({ d, admin }: { d: Detail; admin: { onEditSegment: (focus?: SegmentFocus) => void } | null }) {
  return (
    <div role="status" data-testid="capacity" className="flex items-center gap-3 text-body">
      <p>{admin ? "Not surveyed: enter a survey count to make it bookable." : "Not surveyed, cannot be booked."} No cores to show. Cable size {d.cable_size}.</p>
      {admin && <button type="button" className="btn btn-sm" onClick={() => admin.onEditSegment("survey")}>Enter survey count</button>}
    </div>
  );
}
