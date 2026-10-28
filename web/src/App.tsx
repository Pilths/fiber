import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, authEvents, setDevUser } from "@/api/client";
import { ChangePassword, Login } from "@/components/Auth";
import type { components } from "@/api/schema";
import { EditSiteDialog, EditSpanDialog } from "@/components/AdminEdit";
import { ChosenBar } from "@/components/ChosenBar";
import { CoreDrawer } from "@/components/CoreDrawer";
import { FindCard } from "@/components/FindCard";
import { Header, type View } from "@/components/Header";
import { HeldTable } from "@/components/HeldTable";
import { Icon } from "@/components/Icon";
import { LossCard } from "@/components/LossCard";
import { Facts, Inspector } from "@/components/Inspector";
import { NetworkMap } from "@/components/NetworkMap";
import { PortGrid } from "@/components/PortGrid";
import { RouteForm, RouteSection, RouteSummary, useRoutePlanner } from "@/components/RoutePlanner";
import { Upload } from "@/components/Upload";
import { Users } from "@/components/Users";
import { Approvals, MyReservations, NeedsReview } from "@/components/Reservations";
import { countBy, inFilter, NO_FILTER, spanName, STATUS, STATUS_ORDER, type LossDetail, type SpanFilter, type SpanLoss } from "@/lib/status";

type Span = components["schemas"]["SpanSummary"];
type Detail = components["schemas"]["SpanDetail"];
type Me = components["schemas"]["CurrentUser"];
type Bell = components["schemas"]["Bell"];

// Selection lives in the URL hash so links can be shared: #span=<site A> - <site B>.
// The API has no LRD codes on spans yet, so the hash uses the span name, not the AABB-BBCC form of the PRD.
// Route mode uses #route=<from site id>-<to site id>-<cores>-<km|free_cores>-<option index> (RoutePlanner.tsx).
const hashSpan = () => {
  const m = /^#span=(.+)$/.exec(location.hash);
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
  const [spans, setSpans] = useState<Span[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spanId, setSpanId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [focusCoreId, setFocusCoreId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [view, setViewState] = useState<View>(location.hash === "#users" ? "users" : "map");
  const [bell, setBell] = useState<Bell | null>(null);
  const [stale, setStale] = useState(0);
  const [mapMin, setMapMin] = useState(false);
  const [loss, setLoss] = useState<LossDetail | null>(null);
  const [lossList, setLossList] = useState<SpanLoss[]>([]);
  const [version, setVersion] = useState(0); // bumped after a booking or edit so the span list and grid reload
  const [drawerCore, setDrawerCore] = useState<number | null>(null);
  const [editSpan, setEditSpan] = useState<{ focus?: "survey" } | null>(null);
  const [editSite, setEditSite] = useState<number | null>(null);
  const [filter, setFilter] = useState<SpanFilter>(NO_FILTER);
  const routeOf = useMemo(() => new Map(spans?.map((s) => [s.id, s.route])), [spans]); // map features carry no route
  const [mode, setModeState] = useState<"span" | "route">(location.hash.startsWith("#route=") ? "route" : "span");
  const rp = useRoutePlanner(mode === "route" && view === "map", version);
  // Upload stays mounted once opened (hidden on other views) so a staged preview and its choices survive tab changes.
  const [uploadSeen, setUploadSeen] = useState(false);
  if (view === "upload" && !uploadSeen) setUploadSeen(true);
  // Switching modes clears the other mode's selection and hash.
  const setMode = useCallback((m: "span" | "route") => {
    setModeState(m);
    if (m === "route") {
      setSpanId(null); setDetail(null); setSelected(new Set()); setDrawerCore(null);
      if (location.hash.startsWith("#span=")) history.replaceState(null, "", location.pathname);
    } else if (location.hash.startsWith("#route=")) history.replaceState(null, "", location.pathname);
  }, []);

  const refreshBell = useCallback(() => {
    api.get("/api/bell").then(setBell).catch(() => {});
    api.get("/api/reservations", { query: { mine: true } }).then((r) => setStale(r.filter((x) => x.stale).length)).catch(() => {});
  }, []);
  // Users has its own URL (#users) so it can be visited directly; other views keep the #span= hash.
  const setView = useCallback((v: View) => {
    setViewState(v);
    if (v === "users") history.replaceState(null, "", "#users");
    else if (location.hash === "#users") history.replaceState(null, "", location.pathname);
  }, []);
  useEffect(() => {
    const sync = () => {
      if (location.hash === "#users") setViewState("users");
      if (location.hash.startsWith("#route=")) { setViewState("map"); setMode("route"); }
    };
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, [setMode]);
  useEffect(refreshBell, [refreshBell, view]);

  useEffect(() => {
    api.get("/api/spans").then(setSpans).catch(() => setError("Could not load spans."));
  }, [version, view]);
  // Loss is read-only here; one load per visit to the map is enough.
  useEffect(() => {
    if (view !== "map") return;
    api.get("/api/loss/spans").then(setLossList).catch(() => {});
  }, [view, version]);

  useEffect(() => {
    if (spanId == null) return;
    let stale = false;
    api.get("/api/spans/{span_id}", { path: { span_id: spanId } }).then((d) => !stale && setDetail(d)).catch(() => !stale && setError("Could not load the span."));
    api.get("/api/loss/spans/{span_id}", { path: { span_id: spanId } }).then((l) => !stale && setLoss(l)).catch(() => {});
    return () => { stale = true; };
  }, [spanId, version]);

  const spanRef = useRef(spanId);
  useEffect(() => { spanRef.current = spanId; }, [spanId]);
  const open = useCallback((id: number, coreId: number | null = null) => {
    setView("map");
    setModeState("span");
    setDetail((d) => (d?.id === id ? d : null));
    setSpanId(id);
    setFocusCoreId(coreId);
    setSelected((s) => (s.size ? new Set() : s));
    setDrawerCore(null);
  }, [setView]);

  // Hash -> selection, on load and when the hash changes (back button, pasted link).
  useEffect(() => {
    if (!spans) return;
    const sync = () => {
      const name = hashSpan();
      const s = name && spans.find((x) => spanName(x) === name);
      if (s && spanRef.current !== s.id) open(s.id);
    };
    sync();
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, [spans, open]);
  // Selection -> hash.
  useEffect(() => {
    const s = spans?.find((x) => x.id === spanId);
    if (s && hashSpan() !== spanName(s)) history.replaceState(null, "", `#span=${encodeURIComponent(spanName(s))}`);
  }, [spanId, spans]);

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const chosen = detail?.cores.filter((c) => selected.has(c.id)) ?? [];
  const goToCores = () => {
    const cell = document.querySelector<HTMLElement>('[role=gridcell][data-status="Available"]') ?? document.querySelector<HTMLElement>("[role=gridcell]");
    cell?.scrollIntoView({ block: "center" });
    cell?.focus({ preventScroll: true });
  };
  const changed = () => { setVersion((v) => v + 1); refreshBell(); };
  const drawn = detail?.cores.find((c) => c.id === drawerCore);
  const admin = me.role === "admin" && spanId != null ? {
    onEditSpan: (focus?: "survey") => setEditSpan({ focus }),
    onEditSite: (end: "a" | "b") => {
      api.get("/api/admin/spans/{sid}", { path: { sid: spanId } }).then((x) => setEditSite(end === "a" ? x.site_a_id : x.site_b_id)).catch(() => setError("Could not load the span."));
    },
  } : null;
  const goToRoute = () => {
    const h = document.getElementById("route-h");
    h?.scrollIntoView({ block: "start" });
    h?.focus({ preventScroll: true });
  };
  const planRoute = (site: string) => { setMode("route"); rp.setFrom(site); rp.setTo(""); };
  // Map: a site click lists its spans in Find (span mode) or fills From, then To (route mode); Esc clears the selection.
  const mapSite = (name: string) => {
    if (mode === "span") setFilter((f) => ({ ...f, q: name }));
    else if (!rp.from || rp.to) { rp.setFrom(name); rp.setTo(""); }
    else rp.setTo(name);
  };
  const clearSelection = () => {
    if (mode === "route") { rp.clear(); return; }
    setSpanId(null); setDetail(null); setSelected(new Set()); setDrawerCore(null);
    if (location.hash.startsWith("#span=")) history.replaceState(null, "", location.pathname);
  };
  const routeName = rp.option && `${rp.option.spans[0].site_a} to ${rp.option.spans[rp.option.spans.length - 1].site_b}`;
  const goTo = (id: string) => () => {
    const h = document.getElementById(id);
    h?.scrollIntoView({ block: "start" });
    h?.focus({ preventScroll: true });
  };

  return (
    <div className="min-h-screen">
      <Header onPick={(r) => r.span_id != null && open(r.span_id, r.core_id ?? null)} view={view} onView={setView} me={me}
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
          <section className={`card col-span-8 flex flex-col ${mapMin ? "self-start" : ""}`} aria-labelledby="map-h">
            <div className={`card-h ${mapMin ? "mb-0 border-b-0 pb-0" : ""}`}>
              <h2 id="map-h">Network map</h2>
              <small className="hint">{mode === "route" ? (routeName ? `Route ${routeName} selected` : "No route selected") : detail ? `${spanName(detail)} selected` : "Nothing selected"}</small>
            </div>
            {!mapMin && (
              <NetworkMap version={version} onSelectSpan={(id) => open(id)} onSite={mapSite} onClear={clearSelection}
                selectedIds={mode === "route" ? rp.option?.spans.map((s) => s.span_id) ?? [] : spanId != null ? [spanId] : []}
                routeKey={mode === "route" && rp.option ? `${rp.idx}-${routeName}` : null} visible={(p) => inFilter({ ...p, route: routeOf.get(p.span_id) }, filter)} />
            )}
          </section>
          <div className="col-span-4 flex min-w-0 flex-col gap-4">
            <FindCard spans={spans} selectedId={spanId} onSelect={(id) => open(id)} loss={lossList} mode={mode} onMode={setMode} route={<RouteForm rp={rp} />} filter={filter} onFilter={setFilter} />
            <Inspector detail={detail} loading={spanId != null && !detail} onGoToCores={goToCores} loss={loss?.span_id === spanId ? loss : null} onSeeLoss={goTo("loss-h")} onSeeHeld={goTo("held-h")} admin={admin}
              onPlanRoute={planRoute} route={mode === "route" ? <RouteSummary key={`${rp.idx}-${routeName}`} rp={rp} onGo={goToRoute} /> : undefined} />
          </div>

          {mode === "route" && rp.option && <RouteSection rp={rp} spans={spans} onDone={changed} />}
          {mode === "span" && detail && (
            <div className="col-span-12 space-y-4">
              <section className={`card ${detail.survey_cores != null ? "ccard" : ""}`} aria-labelledby="cores-h">
                <div className="card-h items-center">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1">
                    <h2 id="cores-h" className="text-2xl! leading-8! font-bold! tracking-tight">Cores of {spanName(detail)}</h2>
                    <span className="flex flex-wrap gap-x-4 text-body text-muted-foreground">
                      <Facts d={detail} />
                      {detail.survey_cores != null && <span><b className="font-semibold text-foreground">{detail.survey_cores}</b> surveyed of {detail.cable_size}</span>}
                    </span>
                  </div>
                  <button type="button" className="btn flex-none" aria-pressed={mapMin} onClick={() => setMapMin((m) => !m)}>
                    {mapMin ? "Expand map" : "Collapse map"}
                    <svg viewBox="0 0 16 16" aria-hidden="true" className={`ni ${mapMin ? "rotate-180" : ""}`}><path d="M4 10l4-4 4 4" /></svg>
                  </button>
                </div>
                {detail.survey_cores == null
                  ? (
                    <div role="status" data-testid="capacity" className="flex items-center gap-3 text-body">
                      <p>{admin ? "Not surveyed: enter a survey count to make it bookable." : "Not surveyed, cannot be booked."} No cores to show. Cable size {detail.cable_size}.</p>
                      {admin && <button type="button" className="btn btn-sm" onClick={() => admin.onEditSpan("survey")}>Enter survey count</button>}
                    </div>
                  )
                  : <Cores d={detail} selected={selected} chosen={chosen} toggle={toggle} focusCoreId={focusCoreId} onOpen={(c) => setDrawerCore(c.id)}
                      onClear={() => setSelected(new Set())}
                      onDone={() => { setSelected(new Set()); setVersion((v) => v + 1); refreshBell(); }} />}
              </section>
              <HeldTable d={detail} admin={me.role === "admin"} onOpen={(c) => setDrawerCore(c.id)} onChanged={changed} />
              <LossCard key={detail.id} loss={loss?.span_id === detail.id ? loss : null} />
            </div>
          )}
          {detail && drawn && <CoreDrawer key={drawn.id} core={drawn} span={spanName(detail)} ends={[detail.site_a, detail.site_b]} me={me} onClose={() => setDrawerCore(null)} onChanged={changed} />}
          {editSpan && spanId != null && <EditSpanDialog spanId={spanId} focus={editSpan.focus} onClose={() => setEditSpan(null)} onSaved={changed} />}
          {editSite != null && <EditSiteDialog siteId={editSite} onClose={() => setEditSite(null)} onSaved={changed} />}
        </main>
      )}
    </div>
  );
}

function Cores({ d, selected, chosen, toggle, focusCoreId, onOpen, onClear, onDone }: {
  d: Detail; selected: Set<number>; chosen: Detail["cores"]; toggle: (id: number) => void; focusCoreId: number | null;
  onOpen: (c: Detail["cores"][number]) => void; onClear: () => void; onDone: () => void;
}) {
  const n = countBy(d);
  return (
    <>
      <ul aria-label="Status key" className="mb-1 flex flex-wrap gap-x-5 gap-y-2 text-body text-muted-foreground">
        {(["Available", "Chosen", ...STATUS_ORDER.slice(1)] as const).map((s) => {
          const st = s === "Chosen" ? STATUS.Available : STATUS[s];
          return (
            <li key={s} className="flex items-center gap-2" data-key={s}>
              <span aria-hidden className={`core sw ${st.cls} ${s === "Chosen" ? "sw-chosen" : ""}`}><Icon name={s === "Chosen" ? "ch" : st.icon} /></span>
              {s} <b className="font-bold text-foreground">{s === "Chosen" ? chosen.length : n[s]}</b>
            </li>
          );
        })}
      </ul>
      <PortGrid cores={d.cores} selected={selected} onToggle={toggle} onOpen={onOpen} focusCoreId={focusCoreId} />
      <ChosenBar key={d.id} cores={chosen.map((c) => ({ id: c.id, number: c.number }))} free={d.free_to_reserve} onClear={onClear} onDone={onDone} />
      {chosen.length > 0 && <p className="mt-3 flex items-center gap-2 note px-3 py-2 text-body">
        <Icon name="lo" className="ic flex-none text-amber" />
        <span><b className="font-semibold text-amber">Stale after 3 months.</b> An approved reservation not kept for 3 months is flagged Stale. Keep or release it in My reservations.</span>
      </p>}
    </>
  );
}
