import { useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";

// Shared pieces of the two upload flows (site master and Reservation workbook).

export const PAGE_SIZE = 100;

type Tone = "red" | "amber" | "blue" | "green";
const TONE: Record<Tone, { cls: string; icon: IconName }> = {
  red: { cls: "border-red-bd bg-red-bg text-red", icon: "fl" },
  amber: { cls: "border-amber-bd bg-amber-bg text-amber", icon: "lo" },
  blue: { cls: "border-blue-bd bg-blue-bg text-blue", icon: "ex" },
  green: { cls: "border-green-bd bg-green-bg text-green", icon: "ch" },
};

// Message box: symbol + text, never colour alone. The first line is the title, children are the body.
export function Note({ tone, title, children, role }: { tone: Tone; title: React.ReactNode; children?: React.ReactNode; role?: "alert" | "status" }) {
  const t = TONE[tone];
  return (
    <div role={role} data-tone={tone} className={`flex gap-2.5 rounded-md border px-3.5 py-2.5 text-[13px] ${t.cls}`}>
      <Icon name={t.icon} className="ic mt-[3px]" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 text-foreground">{children}</div>}
      </div>
    </div>
  );
}

// File input (.xlsx only) that also takes a dropped file.
export function FilePick({ label, busy, onFile }: { label: string; busy: boolean; onFile: (f: File) => void }) {
  const id = useId();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && !busy) onFile(f); }}
      className={`flex items-center gap-4 rounded-md border border-dashed px-4 py-3.5 ${over ? "border-blue bg-blue-bg" : "border-line bg-[#f7f8fa]"}`}
    >
      <label htmlFor={id} className="btn btn-p">{busy ? "Reading…" : "Choose .xlsx file"}</label>
      <input id={id} ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label={label}
        className="sr-only" disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <span className="text-[13px] text-muted-foreground">{label}. Or drop the file here. Up to 20 MB.</span>
    </div>
  );
}

export function Chip({ label, n, pressed, onClick, icon }: { label: string; n: number; pressed: boolean; onClick: () => void; icon?: IconName }) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick} data-group={label}>
      {icon && <Icon name={icon} />}{label} <b>{n.toLocaleString("en-GB")}</b>
    </button>
  );
}

export function Pager({ total, page, onPage }: { total: number; page: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return <p className="mt-3 text-[13px] text-muted-foreground">{total.toLocaleString("en-GB")} {total === 1 ? "row" : "rows"}</p>;
  const from = (page - 1) * PAGE_SIZE + 1;
  return (
    <nav aria-label="Pages" className="mt-3 flex items-center gap-3 text-[13px]">
      <span className="text-muted-foreground">Rows {from.toLocaleString("en-GB")}–{Math.min(page * PAGE_SIZE, total).toLocaleString("en-GB")} of {total.toLocaleString("en-GB")}</span>
      <button type="button" className="btn h-8!" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button type="button" className="btn h-8!" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}

// Modal dialog on the native <dialog>: focus moves in on open, Escape closes, focus returns on close.
export function Dialog({ title, children, onClose, wide, cls }: { title: React.ReactNode; children: React.ReactNode; onClose: () => void; wide?: boolean; cls?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const back = useRef<Element | null>(null);
  useEffect(() => {
    back.current = document.activeElement;
    ref.current?.showModal();
    return () => (back.current as HTMLElement | null)?.focus?.();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={id} onClose={onClose} className={`rounded-lg border bg-white p-6 backdrop:bg-black/30 ${cls ?? `m-auto ${wide ? "w-[560px]" : "w-[460px]"}`}`}>
      <h2 id={id} className="text-base font-semibold">{title}</h2>
      {children}
    </dialog>
  );
}

// Field change list "field: old → new"; protected ones are kept and say so.
export function Changes({ changes, extra }: {
  changes: { field: string; old: unknown; new: unknown; protected?: boolean; note?: string; blocked?: string }[];
  extra?: (i: number) => React.ReactNode;
}) {
  const v = (x: unknown) => (x == null || x === "" ? <i className="text-muted-foreground">blank</i> : String(x));
  return (
    <ul className="space-y-1">
      {changes.map((c, i) => (
        <li key={c.field} className="text-[13px]">
          <span className="font-medium">{c.field.replace(/^details\./, "")}</span>: {v(c.old)} <span aria-label="becomes">→</span> {v(c.new)}
          {c.protected && <span className="pill h-amber ml-2"><Icon name="lo" />{c.note ?? "edited in dashboard, file differs"}</span>}
          {c.blocked && <span className="pill h-red ml-2"><Icon name="fl" />{c.blocked}</span>}
          {extra?.(i)}
        </li>
      ))}
    </ul>
  );
}
