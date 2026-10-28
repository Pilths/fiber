import type { ReactNode } from "react";
import type { components } from "@/api/schema";
import { Icon, type IconName } from "@/components/Icon";
import type { SpanFocus } from "@/components/AdminEdit";
import { LossPill } from "@/components/LossCard";
import { countBy, db, health, LEVEL, pct, spanName, STATUS, statusLabel, type LossDetail } from "@/lib/status";

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

export function Inspector({ detail, loading, onGoToCores, loss, onSeeLoss, onSeeHeld, admin, onPlanRoute, route }: {
  detail: Detail | null; loading: boolean; onGoToCores: () => void; loss: LossDetail | null; onSeeLoss: () => void; onSeeHeld: () => void; admin: Admin;
  onPlanRoute: (site: string) => void; route?: ReactNode; // route: the route summary, shown instead of the span in Route mode
}) {
  return (
    <section className="card flex h-[420px] flex-none flex-col overflow-hidden p-0" aria-label="Inspector" data-testid="inspector">
      {route ?? (!detail
        ? <Placeholder title={loading ? "Loading span..." : "No span selected"} text={loading ? undefined : "Select a span from the list in Find, or search by site or span in the top bar."}
          actions={loading ? undefined : <>
            <button type="button" className="btn btn-sm" onClick={() => focusEl("global-search")}>Search by site or span</button>
            <button type="button" className="btn btn-sm" onClick={() => focusEl("find-q")}>Choose from the list</button>
          </>} />
        : <Body d={detail} onGoToCores={onGoToCores} loss={loss} onSeeLoss={onSeeLoss} onSeeHeld={onSeeHeld} admin={admin} onPlanRoute={onPlanRoute} />)}
    </section>
  );
}

const link = "font-[inherit] underline-offset-4 hover:text-blue hover:underline";
type Line = { key: string; icon: IconName; tone: string; word: string; customer: string | null; what: string };

// One line per reservation and status (held cores), then one per count-only reservation; the Allocations table has the detail.
function allocations(d: Detail): Line[] {
  const groups = new Map<string, Detail["cores"]>();
  for (const c of d.cores) {
    if (c.status === "Available") continue;
    const k = `${c.reservation_id ?? "-"}|${c.status}|${c.customer ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return [
    ...[...groups].map(([key, cs]) => ({
      key, icon: STATUS[cs[0].status].icon, tone: STATUS[cs[0].status].tone, word: statusLabel(cs[0].status), customer: cs[0].customer,
      what: `${cs.length === 1 ? "Core" : "Cores"} ${cs.map((c) => c.number).join(", ")}`,
    })),
    ...d.unassigned.map((u) => ({
      key: `u${u.reservation_id}`, icon: "co" as const, tone: "text-use", word: "Unassigned", customer: u.customer,
      what: `${u.remaining} ${u.remaining === 1 ? "core" : "cores"}`,
    })),
  ];
}

function Body({ d, onGoToCores, loss, onSeeLoss, onSeeHeld, admin, onPlanRoute }: {
  d: Detail; onGoToCores: () => void; loss: LossDetail | null; onSeeLoss: () => void; onSeeHeld: () => void; admin: Admin; onPlanRoute: (site: string) => void;
}) {
  const h = health(d);
  const n = countBy(d);
  const surveyed = d.survey_cores != null;
  const cut = d.fiber_cut;
  const parts = [  // reserved includes cores held by count only; faulty cores are in the core grid, not here
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
  // An alert takes room in the fixed card, so Allocations shows fewer lines and the Loss row stays in view.
  const lines = allocations(d);
  const shown = lines.slice(0, cut || lv ? 1 : 3);
  const more = lines.length - shown.length;
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

        <div className={`mt-2 flex items-center gap-2 border-t py-1.5 text-body ${lv ? `-mx-5 px-5 ${tone.row}` : ""}`} data-testid="inspector-loss" data-level={lv ?? undefined}>
          <span className="lbl">Loss</span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            {!loss ? <span className="text-muted-foreground">Loading...</span>
              : loss.measured_db != null ? (
                <><span className={lv ? tone.text : undefined}><b className="font-semibold">{db(loss.measured_db)}</b> measured{loss.deviation_pct != null && `, ${pct(loss.deviation_pct)}`}</span><LossPill l={loss} compact /></>
              ) : <span className="text-muted-foreground">{loss.status === "no_distance" ? "Not measured, no distance" : "Not measured"}</span>}
          </span>
          <button type="button" className="flex-none font-semibold link" onClick={onSeeLoss}>See loss</button>
        </div>

        <div className="border-t pt-2 text-body" data-testid="inspector-held">
          <div className="flex items-center justify-between gap-2">
            <span className="lbl">Allocated</span>
            <button type="button" className="flex-none font-semibold link" onClick={onSeeHeld}>{more > 0 ? `+${more} more in Allocations` : "See allocations"}</button>
          </div>
          {!lines.length ? <p className="text-muted-foreground">None</p> : (
            <ul aria-label="Allocated on this span">
              {shown.map((l) => (
                <li key={l.key} className="grid grid-cols-[104px_minmax(0,1fr)_auto] items-center gap-3 border-b border-rule py-1 last:border-0">
                  <span className={`flex items-center gap-1.5 font-semibold ${l.tone}`}><Icon name={l.icon} />{l.word}</span>
                  <span className="truncate" title={l.customer ?? undefined}>{l.customer ?? "-"}</span>
                  <span className="max-w-36 truncate text-right text-muted-foreground" title={l.what}>{l.what}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="ins-foot">
        <button type="button" className="btn btn-p flex-1" onClick={onGoToCores} disabled={!surveyed}>Go to cores</button>
        <button type="button" className="btn flex-1" onClick={() => onPlanRoute(d.site_a)}>Plan a route from here</button>
      </div>
    </>
  );
}
