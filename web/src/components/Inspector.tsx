import type { ReactNode } from "react";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import type { SpanFocus } from "@/components/AdminEdit";
import { LossPill } from "@/components/LossCard";
import { countBy, db, health, LEVEL, pct, spanName, worstText, type LossDetail } from "@/lib/status";

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

export function Inspector({ detail, loading, loss, admin, route, onDetails, onRoute, onPick }: {
  detail: Detail | null; loading: boolean; loss: LossDetail | null; admin: Admin;
  route?: ReactNode; // route: the route summary, shown instead of the span in Route mode
  onDetails: () => void; onRoute: RouteRow[]; onPick: (id: number) => void; // onRoute: spans of the searched route
}) {
  return (
    <section className="card flex h-[420px] flex-none flex-col overflow-hidden p-0" aria-label="Inspector" data-testid="inspector">
      {route ?? (!detail
        ? <Placeholder title={loading ? "Loading span..." : "No span selected"} text={loading ? undefined : "Select a span from the list in Find, or search by site or span in the top bar."}
          actions={loading ? undefined : <>
            <button type="button" className="btn btn-sm" onClick={() => focusEl("global-search")}>Search by site or span</button>
            <button type="button" className="btn btn-sm" onClick={() => focusEl("find-q")}>Choose from the list</button>
          </>} />
        : <Body key={detail.id} d={detail} loss={loss} admin={admin} onRoute={onRoute} onPick={onPick} />)}
      {!route && (
        <div className="ins-foot">
          <button type="button" className="btn btn-p flex-1 justify-between" onClick={onDetails} disabled={!detail} aria-label="Open span details">
            Details<span aria-hidden>&#9660;</span>
          </button>
        </div>
      )}
    </section>
  );
}

const link = "font-[inherit] underline-offset-4 hover:text-blue hover:underline";
export type RouteRow = { id: number; name: string; km: number | null };

function Body({ d, loss, admin, onRoute, onPick }: { d: Detail; loss: LossDetail | null; admin: Admin; onRoute: RouteRow[]; onPick: (id: number) => void }) {
  const h = health(d);
  const n = countBy(d);
  const surveyed = d.survey_cores != null;
  const cut = d.fiber_cut;
  const parts = [  // reserved includes cores held by count only
    { k: "k-free", v: d.free_to_reserve, label: "Free to reserve" },
    { k: "k-cores", v: n.Reserved + n.Requested + d.unassigned_reserved, label: "Reserved" },
    { k: "k-use", v: n["In use"], label: "In service" },
  ];
  // Loss alert strip: amber or worse, measured only. The card has one alert slot: a cut span shows the cut banner,
  // and its loss stays visible in the red or amber Loss row.
  const lv = loss?.measured_db != null && loss.deviation_pct != null && loss.level && loss.level !== "green" ? loss.level : null;
  const high = lv === "red" || lv === "off_scale";
  // Literal class names so Tailwind finds them.
  const tone = high
    ? { strip: "border-red-bd bg-red-bg text-red", row: "bg-red-bg shadow-[inset_3px_0_0_var(--red)]", text: "text-red" }
    : { strip: "border-amber-bd bg-amber-bg text-amber", row: "bg-amber-bg shadow-[inset_3px_0_0_var(--amber)]", text: "text-amber" };
  return (
    <>
      <div className="ins-head">
        <div className="flex items-start justify-between gap-3">
          <h3 className={`ins-title ${spanName(d).length > 22 ? "long" : ""}`}>
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
              <p data-testid="loss-alert" data-level={lv} className={`flex items-center gap-2.5 rounded-md border px-3 py-1.5 ${tone.strip}`}>
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
              <p className="text-body text-muted-foreground">free to reserve</p>
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
            <p className="flex-1 text-muted-foreground">Not surveyed: enter a survey count to make it bookable. Cable size {d.cable_size}.</p>
            <button type="button" className="btn btn-sm flex-none" onClick={() => admin.onEditSpan("survey")}>Enter survey count</button>
          </div>
        ) : <p className="text-body text-muted-foreground">Not surveyed, cannot be booked. Cable size {d.cable_size}.</p>}

        <div className={`mt-1.5 flex items-center gap-2 border-t py-1 text-body ${lv ? `-mx-5 px-5 ${tone.row}` : ""}`} data-testid="inspector-loss" data-level={lv ?? undefined}>
          <span className="lbl flex-none">Worst core</span>
          <span className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
            {!loss ? <span className="text-muted-foreground">Loading...</span>
              : loss.measured_db != null ? (
                <>
                  <span className={lv ? tone.text : undefined}>
                    <b className="font-semibold">{worstText(loss)}</b>
                    <span className="block text-xs text-muted-foreground">{loss.deviation_pct != null && `${pct(loss.deviation_pct)}, `}{loss.measured_cores} of {loss.total_cores} cores measured</span>
                  </span>
                  <LossPill l={loss} compact />
                </>
              ) : <span className="text-muted-foreground">No core measured</span>}
          </span>
        </div>

        {onRoute.length > 0 && (
          <div className="mt-2 border-t pt-1.5">
            <h4 className="lbl">Spans on route</h4>
            <ul aria-label="Spans on route" className="text-body">
              {onRoute.map((r) => (
                <li key={r.id}>
                  <button type="button" aria-pressed={r.id === d.id} onClick={() => onPick(r.id)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-raised ${r.id === d.id ? "bg-blue-bg font-semibold" : ""}`}>
                    <span className="truncate">{r.name}</span>{r.km != null && <span className="text-muted-foreground">{Number(r.km)} km</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
