import { useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { db, LEVEL, pct, signedDb, type LossDetail, type SpanLoss } from "@/lib/status";

export function LossPill({ l }: { l: Pick<SpanLoss, "level" | "deviation_pct"> }) {
  if (!l.level) return null;
  const v = LEVEL[l.level];
  const word = l.level === "green" && (l.deviation_pct ?? 0) < 0 ? "Below calculated" : v.word;
  return <span className={`pill ${v.cls}`} data-level={l.level}><Icon name={v.icon} />{word}</span>;
}

const NOTE: Record<SpanLoss["status"], string | null> = {
  measured: null,
  calculated_only: "Not measured yet. Calculated only.",
  no_distance: "No distance in the Excel, so no calculated loss.",
};

function Metric({ label, value, sub, children }: { label: string; value?: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="min-w-0 border-l border-rule pl-4 first:border-l-0 first:pl-0">
      <dt className="lbl">{label}</dt>
      <dd className="mt-0.5">
        {children ?? <span className="block text-2xl leading-8 font-bold tracking-tight">{value}</span>}
        {sub && <span className="mt-0.5 block text-[13px] text-muted-foreground">{sub}</span>}
      </dd>
    </div>
  );
}

// "Loss" card for one span, after the held table (PRD story 4).
export function LossCard({ loss, coverage }: { loss: LossDetail | null; coverage: { measured: number; total: number } | null }) {
  const [all, setAll] = useState(false);
  const calc = loss?.calculated_db ?? null;
  const rows = loss ? (all ? loss.history : loss.history.slice(0, 5)) : [];
  return (
    <section id="loss" className="card" aria-labelledby="loss-h" data-testid="loss-card">
      <div className="card-h">
        <h2 id="loss-h" tabIndex={-1} className="outline-offset-4">Loss{loss && <span className="font-normal text-muted-foreground"> of {loss.span_name}</span>}</h2>
        {coverage && <small className="hint" data-testid="loss-coverage"><b className="font-semibold text-foreground">{coverage.measured} of {coverage.total}</b> spans measured</small>}
      </div>
      {!loss ? <p className="text-[13px] text-muted-foreground">Loading loss...</p> : (
        <>
          <dl className="grid grid-cols-4 gap-4">
            <Metric label="Calculated" value={calc == null ? "No distance" : db(calc)}
              sub={calc == null ? "No calculated loss" : `${Number(loss.distance_km)} km × 0.3 dB/km`} />
            <Metric label="Latest measured" value={loss.measured_db == null ? "Not measured" : db(loss.measured_db)}
              sub={loss.measured_db == null ? undefined : [loss.last_test_date, loss.test_method, loss.field_team].filter(Boolean).join(", ")} />
            <Metric label="Difference" value={loss.difference_db == null ? "-" : signedDb(loss.difference_db)}
              sub={loss.deviation_pct == null ? undefined : `${pct(loss.deviation_pct)} of calculated`} />
            <Metric label="Level">
              {loss.level ? <span className="mt-1.5 block"><LossPill l={loss} /></span> : <span className="block text-2xl leading-8 font-bold text-muted-foreground">-</span>}
            </Metric>
          </dl>
          {NOTE[loss.status] && (
            <p role="status" className="mt-4 rounded-md border border-dashed border-line px-4 py-3 text-[13px] text-muted-foreground">
              <b className="font-semibold text-foreground">{NOTE[loss.status]}</b>
            </p>
          )}
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="loss-legend">
            <span>Bands, measured against calculated:</span>
            <span className="inline-flex items-center gap-1.5"><Icon name="ch" />0 to 3% (or below calculated)</span>
            <span className="inline-flex items-center gap-1.5"><Icon name="lo" />3 to 7%</span>
            <span className="inline-flex items-center gap-1.5"><Icon name="fl" />7 to 10%</span>
            <span className="inline-flex items-center gap-1.5"><Icon name="ex" />above 10%, off scale</span>
          </p>
          {loss.history.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <div className="lbl">Tests, newest first</div>
              <table className="tbl table-fixed" data-testid="loss-history">
                <caption className="sr-only">Loss tests on this span, newest first</caption>
                <thead><tr>
                  <th scope="col" className="w-[18%]">Tested</th><th scope="col" className="w-[18%]">Measured</th><th scope="col" className="w-[18%]">Difference</th>
                  <th scope="col">Method</th><th scope="col" className="pr-0!">Field team</th>
                </tr></thead>
                <tbody>
                  {rows.map((h, i) => (
                    <tr key={i}>
                      <th scope="row" className="text-left font-semibold">{h.tested_on}</th>
                      <td>{db(h.loss_db)}</td>
                      <td>{calc ? pct(((h.loss_db - calc) / calc) * 100) : "-"}</td>
                      <td className="truncate">{h.test_method ?? "-"}</td>
                      <td className="truncate pr-0">{h.field_team ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {loss.history.length > 5 && (
                <button type="button" className="btn mt-2" onClick={() => setAll((a) => !a)}>
                  {all ? "Show the newest 5" : `Show all ${loss.history.length} tests`}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
