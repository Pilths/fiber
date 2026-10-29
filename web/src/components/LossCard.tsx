import { useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { db, LEVEL, pct, signedDb, type LossDetail, type SpanLoss } from "@/lib/status";

// A blank table value with its meaning, muted: "Not recorded" (should exist, missing), "Not applicable", "No ports yet".
export const Blank = ({ children = "Not recorded" }: { children?: string }) => <span className="font-normal text-muted-foreground">{children}</span>;

// A loss number in its level's colour (no chip); the level word stays for screen readers.
export function LossNum({ l, children }: { l: Pick<SpanLoss, "level" | "deviation_pct">; children: string }) {
  if (!l.level) return <>{children}</>;
  const word = l.level === "green" && (l.deviation_pct ?? 0) < 0 ? "Below calculated" : LEVEL[l.level].word;
  return <span className={`font-semibold ${LEVEL[l.level].cls.replace("h-", "v-")}`} data-level={l.level}>{children}<span className="sr-only">, {word}</span></span>;
}

export function LossPill({ l, compact }: { l: Pick<SpanLoss, "level" | "deviation_pct">; compact?: boolean }) {
  if (!l.level) return null;
  const v = LEVEL[l.level];
  const word = l.level === "green" && (l.deviation_pct ?? 0) < 0 ? "Below calculated" : v.word;
  if (compact) return <span className={`pill ${v.cls}`} data-level={l.level} title={word}><Icon name={v.icon} /><span className="sr-only">{word}</span></span>;
  return <span className={`pill ${v.cls}`} data-level={l.level}><Icon name={v.icon} />{word}</span>;
}

const NOTE: Record<SpanLoss["status"], string | null> = {
  measured: null,
  calculated_only: "Not measured yet. Calculated only.",
  no_distance: "No distance in the Excel, so no calculated loss.",
};

export function Metric({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return (
    <div className="min-w-0 border-l border-rule pl-4 first:border-l-0 first:pl-0">
      <dt className="lbl">{label}</dt>
      <dd className="mt-0.5">
        {children ?? <span className="block text-2xl leading-8 font-bold tracking-tight">{value}</span>}
      </dd>
    </div>
  );
}

// "Loss" card for one span, after the held table (PRD story 4).
export function LossCard({ loss }: { loss: LossDetail | null }) {
  const [all, setAll] = useState(false);
  const calc = loss?.calculated_db ?? null;
  const rows = loss ? (all ? loss.history : loss.history.slice(0, 5)) : [];
  return (
    <section id="loss" className="card" aria-labelledby="loss-h" data-testid="loss-card">
      <div className="card-h">
        <h2 id="loss-h" tabIndex={-1} className="outline-offset-4">Loss{loss && <span className="font-normal text-muted-foreground"> of {loss.span_name}</span>}</h2>
      </div>
      {!loss ? <p className="text-body text-muted-foreground">Loading loss...</p> : (
        <>
          <dl className="grid grid-cols-4 gap-4">
            <Metric label="Calculated" value={calc == null ? "No distance" : db(calc)} />
            <Metric label="Latest measured" value={loss.measured_db == null ? "Not measured" : db(loss.measured_db)} />
            <Metric label="Difference" value={loss.difference_db == null ? "-" : signedDb(loss.difference_db)} />
            <Metric label="Level">
              {loss.level ? <span className="mt-1.5 block"><LossPill l={loss} /></span> : <span className="block text-2xl leading-8 font-bold text-muted-foreground">-</span>}
            </Metric>
          </dl>
          {NOTE[loss.status] && (
            <p role="status" className="mt-4 empty px-4 py-3 text-body text-muted-foreground">
              <b className="font-semibold text-foreground">{NOTE[loss.status]}</b>
            </p>
          )}
          {loss.history.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <h3 className="lbl mb-1">History</h3>
              <table className="tbl table-fixed" data-testid="loss-history">
                <caption className="sr-only">Loss tests on this span, newest first</caption>
                <thead><tr>
                  <th scope="col" className="w-[18%]">Tested</th><th scope="col" className="w-[18%]">Measured</th><th scope="col" className="w-[18%]">Difference</th>
                  <th scope="col">Method</th><th scope="col" className="pr-0!">Verified by</th>
                </tr></thead>
                <tbody>
                  {rows.map((h, i) => (
                    <tr key={i}>
                      <th scope="row" className="text-left font-semibold">{h.tested_on}</th>
                      <td>{db(h.loss_db)}</td>
                      <td>{calc ? pct(((h.loss_db - calc) / calc) * 100) : <Blank>Not applicable</Blank>}</td>
                      <td className="truncate">{h.test_method ?? <Blank />}</td>
                      <td className="truncate pr-0">{h.field_team ?? <Blank />}</td>
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
