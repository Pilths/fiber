import type { ReactNode } from "react";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import type { SpanFocus } from "@/components/AdminEdit";
import { LossPill } from "@/components/LossCard";
import { countBy, db, health, LEVEL, pct, spanName, type LossDetail } from "@/lib/status";

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

type Admin = { onEditSpan: (focus?: SpanFocus) => void; onEditSite: (end: "a" | "b") => void } | null; // null for planners

export function Inspector({ detail, loading, onGoToCores, loss, onSeeLoss, onSeeHeld, admin, onPlanRoute, route }: {
  detail: Detail | null; loading: boolean; onGoToCores: () => void; loss: LossDetail | null; onSeeLoss: () => void; onSeeHeld: () => void; admin: Admin;
  onPlanRoute: (site: string) => void; route?: ReactNode; // route: the route summary, shown instead of the span in Route mode
}) {
  const tab = "relative inline-flex h-10 items-center gap-2 border-b-2 border-transparent -mb-px px-2.5 font-semibold whitespace-nowrap focus-visible:-outline-offset-3";
  const later = (name: string) => (
    <button type="button" role="tab" aria-selected="false" aria-disabled="true" title={`${name}: later`} className={`${tab} cursor-not-allowed font-medium text-muted-foreground`}
      onClick={(e) => e.preventDefault()}>
      {name}<span className="later">Later</span>
    </button>
  );
  return (
    <section className="card flex flex-[1_0_auto] flex-col pt-0" aria-label="Inspector">
      <div role="tablist" aria-label="Inspector" className="-mx-5 mb-4 flex gap-1 border-b px-2.5">
        <button type="button" role="tab" aria-selected="true" className={`${tab} border-b-foreground`}>Cores</button>
        {later("Site")}
        {later("Services")}
      </div>
      <div role="tabpanel" aria-label="Cores" className="flex flex-1 flex-col">
        {route ?? (!detail ? (
          <p className="empty px-4 py-5 text-center text-body text-muted-foreground">
            <b className="mb-0.5 block text-sm font-semibold text-foreground">{loading ? "Loading span..." : "No span selected"}</b>
            {!loading && "Choose a span in Find, or search in the top bar."}
          </p>
        ) : <Body d={detail} onGoToCores={onGoToCores} loss={loss} onSeeLoss={onSeeLoss} onSeeHeld={onSeeHeld} admin={admin} onPlanRoute={onPlanRoute} />)}
      </div>
    </section>
  );
}

const link = "font-[inherit] underline-offset-4 hover:text-blue hover:underline";

function Body({ d, onGoToCores, loss, onSeeLoss, onSeeHeld, admin, onPlanRoute }: {
  d: Detail; onGoToCores: () => void; loss: LossDetail | null; onSeeLoss: () => void; onSeeHeld: () => void; admin: Admin; onPlanRoute: (site: string) => void;
}) {
  const h = health(d);
  const n = countBy(d);
  const surveyed = d.survey_cores != null;
  const withCores = n.Reserved + n.Requested + n["In use"];
  const cut = d.fiber_cut;
  const parts = [  // reserved includes cores held by count only; faulty cores are in the core grid, not here
    { k: "k-free", v: d.free_to_reserve, label: "Free to reserve" },
    { k: "k-cores", v: n.Reserved + n.Requested + d.unassigned_reserved, label: "Reserved" },
    { k: "k-use", v: n["In use"], label: "In service" },
  ];
  // Loss alert strip: amber or worse, measured only.
  const lv = loss?.measured_db != null && loss.deviation_pct != null && loss.level && loss.level !== "green" ? loss.level : null;
  const high = lv === "red" || lv === "off_scale";
  // Literal class names so Tailwind finds them.
  const tone = high
    ? { strip: "border-red-bd bg-red-bg text-red", row: "bg-red-bg shadow-[inset_3px_0_0_var(--red)]", text: "text-red" }
    : { strip: "border-amber-bd bg-amber-bg text-amber", row: "bg-amber-bg shadow-[inset_3px_0_0_var(--amber)]", text: "text-amber" };
  return (
    <>
      <h3 className="text-2xl leading-[30px] font-bold tracking-tight">
        {admin ? (
          <>
            <button type="button" className={link} aria-label={`Edit site ${d.site_a}`} onClick={() => admin.onEditSite("a")}>{d.site_a}</button>
            {" - "}
            <button type="button" className={link} aria-label={`Edit site ${d.site_b}`} onClick={() => admin.onEditSite("b")}>{d.site_b}</button>
          </>
        ) : spanName(d)}
      </h3>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-body text-muted-foreground">
        <Facts d={d} />
        {admin && <button type="button" className="btn btn-sm ml-auto" onClick={() => admin.onEditSpan()}>Edit span</button>}
      </div>
      {(cut || lv) && (
        <div className="mt-4 space-y-2 text-body">
          {cut && (
            <div data-testid="fiber-cut" className="flex items-center gap-2.5 rounded-md border border-red-bd bg-red-bg px-3 py-2 text-red">
              <Icon name="fl" />
              <p className="min-w-0 flex-1"><b className="font-semibold">Fiber cut</b><span className="block text-foreground">All cores on this span are unavailable.</span></p>
              {admin && <button type="button" className="btn btn-sm flex-none" onClick={() => admin.onEditSpan("restore")}>Restore</button>}
            </div>
          )}
          {lv && (
            <p data-testid="loss-alert" data-level={lv} className={`flex items-center gap-2.5 rounded-md border px-3 py-2 ${tone.strip}`}>
              <Icon name={LEVEL[lv].icon} />
              <span className="min-w-0 flex-1"><b className="font-semibold">{high ? "High loss" : "Loss above calculated"}:</b> {db(loss!.measured_db!)} measured, {pct(loss!.deviation_pct!)} over calculated</span>
              <span className="flex-none font-semibold">{LEVEL[lv].word}</span>
            </p>
          )}
        </div>
      )}
      <div className="mt-5 border-t pt-4">
        <div className="lbl">Free to reserve</div>
        <div className={`mt-0.5 flex items-center gap-2.5 text-[40px] leading-[46px] font-bold tracking-tight ${surveyed || cut ? h.cls.replace("h-", "v-") : "text-muted-foreground"}`}>
          {cut ? 0 : surveyed ? d.free_to_reserve : "-"}
          {cut
            ? <span className={`pill tracking-normal ${h.cls}`}><Icon name={h.icon} />{h.word}</span>
            : <span className={`pill tracking-normal ${h.cls}`} title={h.word}><Icon name={h.icon} /><span className="sr-only">{h.word}</span></span>}
        </div>
        {surveyed ? (
          <>
            <div className="mt-3.5 flex h-2 gap-0.5" aria-hidden data-testid="free-bar">
              {cut ? <span className="k k-fault h-full rounded" style={{ flex: 1 }} />
                : parts.filter((p) => p.v > 0).map((p) => <span key={p.k} className={`k ${p.k} h-full rounded`} style={{ flex: p.v }} />)}
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-body text-muted-foreground">
              {parts.map((p) => (
                <div key={p.k} className="flex items-center gap-2">
                  <dt className="order-1">{p.label}</dt>
                  <dd className="flex min-w-[38px] items-center gap-2 font-bold text-foreground"><span className={`k ${p.k}`} />{p.v}</dd>
                </div>
              ))}
              {cut && (
                <div className="flex items-center gap-2">
                  <dt className="order-1 font-semibold text-red">Fiber cut</dt>
                  <dd className="flex min-w-[38px] items-center gap-2 font-bold text-red"><span className="k k-fault" />All</dd>
                </div>
              )}
            </dl>
          </>
        ) : admin ? (
          <div className="mt-1 text-body">
            <p className="text-muted-foreground">Not surveyed: enter a survey count to make it bookable. Cable size {d.cable_size}.</p>
            <button type="button" className="btn btn-sm mt-2" onClick={() => admin.onEditSpan("survey")}>Enter survey count</button>
          </div>
        ) : <p className="mt-1 text-body text-muted-foreground">Not surveyed, cannot be booked. Cable size {d.cable_size}.</p>}
      </div>
      <div className={`mt-5 flex items-center gap-2 border-t text-body ${lv ? `-mx-5 px-5 py-3 ${tone.row}` : "pt-4"}`} data-testid="inspector-loss" data-level={lv ?? undefined}>
        <span className="lbl">Loss</span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {!loss ? <span className="text-muted-foreground">Loading...</span>
            : loss.measured_db != null ? (
              <><span className={lv ? tone.text : undefined}><b className="font-semibold">{db(loss.measured_db)}</b> measured{loss.deviation_pct != null && `, ${pct(loss.deviation_pct)}`}</span><LossPill l={loss} compact /></>
            ) : <span className="text-muted-foreground">{loss.status === "no_distance" ? "Not measured, no distance" : "Not measured"}</span>}
        </span>
        <button type="button" className="flex-none font-semibold link" onClick={onSeeLoss}>See loss</button>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t pt-3 text-body" data-testid="inspector-held">
        <span className="lbl">Allocated</span>
        <span className="min-w-0 flex-1">
          {withCores + n.Faulty + d.unassigned_reserved === 0 ? <span className="text-muted-foreground">None</span> : (
            <><b className="font-semibold">{withCores + d.unassigned_reserved}</b> cores{n.Requested > 0 && `, ${n.Requested} waiting approval`}{n.Faulty > 0 && `, ${n.Faulty} faulty`}</>
          )}
        </span>
        <button type="button" className="flex-none font-semibold link" onClick={onSeeHeld}>See allocations</button>
      </div>
      <div className="-mx-5 mt-auto flex flex-wrap gap-2 border-t bg-white px-5 py-5">
        <button type="button" className="btn btn-p flex-1" onClick={onGoToCores} disabled={!surveyed}>Go to cores</button>
        <button type="button" className="btn flex-1" onClick={() => onPlanRoute(d.site_a)}>Plan a route from here</button>
      </div>
    </>
  );
}
