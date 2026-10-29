import type { ReactNode } from "react";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { LossNum } from "@/components/LossCard";
import type { SpanFocus } from "@/components/AdminEdit";
import { countBy, db, health, LEVEL, pct, perKm, spanName, totalLoss, type LossDetail } from "@/lib/status";

type Detail = components["schemas"]["SpanDetail"];

export const Facts = ({ d }: { d: Detail }) => (
  <>
    {d.region && <b className="font-semibold text-foreground">{d.region}</b>}
    {d.route_type && <b className="font-semibold text-foreground">{d.route_type}</b>}
    {d.distance_km && <span><b className="font-semibold text-foreground">{Number(d.distance_km)}</b> km</span>}
    {d.route && <span>Route <b className="font-semibold text-foreground">{d.route}</b></span>}
    {d.section && <span>Section <b className="font-semibold text-foreground">{d.section}</b></span>}
  </>
);

// Nothing selected: a dashed placeholder filling the same card.
// actions: buttons that move focus to the control the text names.
export const Placeholder = ({ title, text, actions }: { title: string; text?: string; actions?: ReactNode }) => (
  <div className="flex min-h-0 flex-1 p-5">
    <p className="empty flex flex-1 flex-col items-center justify-center text-center text-body text-muted-foreground">
      <b className="mb-0.5 block text-sm font-semibold text-foreground">{title}</b>{text}
      {actions && <span className="mt-3 flex flex-wrap justify-center gap-2">{actions}</span>}
    </p>
  </div>
);

const focusEl = (id: string) => document.getElementById(id)?.focus();

type Admin = { onEditSpan: (focus?: SpanFocus) => void; onEditSite: (end: "a" | "b") => void } | null; // null for planners

// fill: take the full height of a relative parent (Map page, beside the map); else the fixed 420px card (Reserve tab).
export function Inspector({ detail, loading, loss, admin, route, onCores, fill }: {
  detail: Detail | null; loading: boolean; loss: LossDetail | null; admin: Admin;
  route?: ReactNode; // route: the route summary, shown instead of the span in Route mode
  onCores: () => void; fill?: boolean;
}) {
  return (
    <section className={`card flex flex-col overflow-hidden p-0 ${fill ? "absolute inset-0" : "h-[420px] flex-none"}`} aria-label="Inspector" data-testid="inspector">
      {route ?? (!detail
        ? <Placeholder title={loading ? "Loading span..." : "No span selected"} text={loading ? undefined : "Select a span on the map, search a route above the map, or search by site or span in the top bar."}
          actions={loading ? undefined : <>
            <button type="button" className="btn btn-sm" onClick={() => focusEl("route-a")}>Search a route</button>
            <button type="button" className="btn btn-sm" onClick={() => focusEl("global-search")}>Search by site or span</button>
          </>} />
        : <Body key={detail.id} d={detail} loss={loss} admin={admin} />)}
      {!route && (
        <div className="ins-foot">
          <button type="button" className="btn btn-p flex-1 justify-between" onClick={onCores} disabled={!detail} aria-label="Go to cores">
            Cores<span aria-hidden>&#9660;</span>
          </button>
        </div>
      )}
    </section>
  );
}

const link = "font-[inherit] underline-offset-4 hover:text-blue hover:underline";

function Body({ d, loss, admin }: { d: Detail; loss: LossDetail | null; admin: Admin }) {
  const h = health(d);
  const n = countBy(d);
  const surveyed = d.survey_cores != null;
  const cut = d.fiber_cut;
  const t = totalLoss(loss), km = d.distance_km ? Number(d.distance_km) : null;
  const parts = [  // reserved includes cores held by count only
    { k: "k-free", v: d.free_to_reserve, label: "Free to reserve" },
    { k: "k-cores", v: n.Reserved + n.Requested + d.unassigned_reserved, label: "Reserved" },
    { k: "k-use", v: n["In use"], label: "In service" },
  ];
  // Loss alert strip: amber or worse, measured only. The card has one alert slot: a cut span shows the cut banner,
  // and the core table carries per-core loss.
  const lv = loss?.measured_db != null && loss.deviation_pct != null && loss.level && loss.level !== "green" ? loss.level : null;
  const high = lv === "red" || lv === "off_scale";
  const strip = high ? "border-red-bd bg-red-bg text-red" : "border-amber-bd bg-amber-bg text-amber"; // literal for Tailwind
  return (
    <>
      <div className="ins-head">
        <div className="flex items-start justify-between gap-3">
          <h3 id="span-h" className={`ins-title ${spanName(d).length > 22 ? "long" : ""}`}>
            {admin ? (
              <>
                <button type="button" className={link} aria-label={`Edit site ${d.site_a}`} onClick={() => admin.onEditSite("a")}>{d.site_a}</button>
                {" - "}
                <button type="button" className={link} aria-label={`Edit site ${d.site_b}`} onClick={() => admin.onEditSite("b")}>{d.site_b}</button>
              </>
            ) : spanName(d)}
          </h3>
          {/* Health reads from the big number's colour and the bar; only a cut span gets a chip. */}
          {cut && <span className="pill h-red mt-2 flex-none" data-testid="health"><Icon name="fl" />Cut</span>}
        </div>
        <div className="ins-facts">
          <Facts d={d} />
          {admin && <button type="button" className="ml-auto font-semibold link" onClick={() => admin.onEditSpan()}>Edit span</button>}
        </div>
      </div>

      <div className="ins-body">
        {(cut || lv) && (
          <div className="mb-2 space-y-2 text-body">
            {cut && (
              <div data-testid="fiber-cut" className="flex items-center gap-2.5 rounded-md border border-red-bd bg-red-bg px-3 py-1.5 text-red">
                <Icon name="fl" />
                <p className="min-w-0 flex-1"><b className="font-semibold">Fiber cut</b><span className="block text-foreground">All cores on this span are unavailable.</span></p>
                {admin && <button type="button" className="btn btn-sm flex-none" onClick={() => admin.onEditSpan("restore")}>Restore</button>}
              </div>
            )}
            {lv && !cut && (
              <p data-testid="loss-alert" data-level={lv} className={`flex items-center gap-2.5 rounded-md border px-3 py-1.5 ${strip}`}>
                <Icon name={LEVEL[lv].icon} />
                <span className="min-w-0 flex-1"><b className="font-semibold">{high ? "High loss" : "Loss above calculated"}:</b> {db(loss!.measured_db!)} measured, {pct(loss!.deviation_pct!)} over calculated</span>
                <span className="flex-none font-semibold">{LEVEL[lv].word}</span>
              </p>
            )}
          </div>
        )}

        {surveyed || cut ? (
          <>
            <div className="flex items-baseline gap-2.5">
              <span className={`text-[32px] leading-9 font-bold tracking-tight ${h.cls.replace("h-", "v-")}`}>{cut ? 0 : d.free_to_reserve}</span>
              <p className="text-body font-semibold text-muted-foreground">free of {d.survey_cores ?? "-"}</p>
            </div>
            <div className="mt-1.5 flex h-2 gap-0.5" aria-hidden data-testid="free-bar">
              {cut ? <span className="k k-fault h-full rounded" style={{ flex: 1 }} />
                : parts.filter((p) => p.v > 0).map((p) => <span key={p.k} className={`k ${p.k} h-full rounded`} style={{ flex: p.v }} />)}
            </div>
            <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {cut && (
                <div className="flex items-center gap-1.5">
                  <dt className="order-1 font-semibold text-red">Fiber cut</dt>
                  <dd className="flex items-center gap-1.5 font-bold text-red"><span className="k k-fault" />All</dd>
                </div>
              )}
              {parts.filter((p) => !cut || p.k !== "k-free").map((p) => ( // cut: the big 0 already says nothing is free
                <div key={p.k} className="flex items-center gap-1.5">
                  <dt className="order-1">{p.label}</dt>
                  <dd className="flex items-center gap-1.5 font-bold text-foreground"><span className={`k ${p.k}`} />{p.v}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : admin ? (
          <div className="flex items-center gap-3 text-body">
            <p className="flex-1 font-semibold text-muted-foreground">Not surveyed</p>
            <button type="button" className="btn btn-sm flex-none" onClick={() => admin.onEditSpan("survey")}>Enter survey count</button>
          </div>
        ) : <p className="text-body font-semibold text-muted-foreground">Not surveyed</p>}

        {/* Span facts: total loss is the worst measured core, else the calculated loss (distance x 0.3 dB/km). */}
        <dl className="mt-4 border-t text-body [&>div]:flex [&>div]:min-h-10 [&>div]:items-center [&>div]:justify-between [&>div]:gap-3 [&>div]:border-b [&>div]:py-1.5 [&_dd]:text-right [&_dd]:font-semibold" data-testid="span-facts">
          <div><dt>Distance</dt><dd>{km ? `${km} km` : "-"}</dd></div>
          <div><dt>Free cores</dt><dd>{surveyed ? `${cut ? 0 : d.free_to_reserve} of ${d.survey_cores}` : "-"}</dd></div>
          <div><dt>Cable size</dt><dd>{d.cable_size}</dd></div>
          <div data-testid="inspector-loss" data-level={loss?.level ?? undefined}><dt>{t?.calc ? "Calculated loss" : "Total loss"}</dt><dd>{!loss ? "Loading..." : !t ? "-" : t.calc ? db(t.db) : <LossNum l={loss}>{db(t.db)}</LossNum>}</dd></div>
          <div><dt>Average loss per km</dt><dd>{!loss ? "Loading..." : t && km ? perKm(t.db, km) : "-"}</dd></div>
        </dl>
      </div>
    </>
  );
}
