import { Icon, type IconName } from "@/components/Icon";
import { Chip, Dialog, Pager } from "@/components/upload-parts";
import type { PagedRows } from "@/lib/usePagedRows";

// Shared pieces of an upload preview: the preview card, the confirm dialog and the paged rows table.

export type GroupInfo<Group> = { g: Group; label: string; icon: IconName; cls: string };

// "Preview of {filename}" card. With `onDiscard` it ends in its own "Discard preview" row;
// without it the screen places that button itself.
export function PreviewCard({ titleId, testId, filename, roomy, onDiscard, children }: {
  titleId: string;
  testId: string;
  filename: string;
  roomy?: boolean;
  onDiscard?: () => void;
  children: React.ReactNode;
}) {
  const spacing = roomy ? "space-y-6" : "space-y-4";
  return (
    <section aria-labelledby={titleId} className="card" data-testid={testId}>
      <div className="card-h">
        <h2 id={titleId} className="truncate">Preview of {filename}</h2>
      </div>
      <div className={spacing}>
        {children}
        {onDiscard && (
          <div className="border-t pt-4">
            <button type="button" className="btn" onClick={onDiscard}>Discard preview</button>
          </div>
        )}
      </div>
    </section>
  );
}

export function ConfirmDialog({ title, confirmLabel = "Apply", wide, onCancel, onConfirm, children }: {
  title: string;
  confirmLabel?: string;
  wide?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog title={title} onClose={onCancel} wide={wide}>
      {children}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-p" onClick={onConfirm} autoFocus>{confirmLabel}</button>
      </div>
    </Dialog>
  );
}

// One chip per result group, the chosen one pressed.
export function GroupChips<Group extends string>({ label, groups, counts, current, onChoose }: {
  label: string;
  groups: GroupInfo<Group>[];
  counts: Record<Group, number>;
  current: Group;
  onChoose: (group: Group) => void;
}) {
  return (
    <div role="group" aria-label={label} className="mb-3 flex flex-wrap gap-2">
      {groups.map((info) => (
        <Chip key={info.g} label={info.label} icon={info.icon} n={counts[info.g]} pressed={current === info.g}
          onClick={() => onChoose(info.g)} />
      ))}
    </div>
  );
}

// The "Status or reason" cell: the group word with its symbol, then any detail below it.
export function StatusCell<Group extends string>({ info, children }: {
  info: GroupInfo<Group>;
  children?: React.ReactNode;
}) {
  const tone = info.cls === "h-amber" ? "font-semibold text-amber" : "";
  const word = info.g === "problem" ? "Needs review" : info.label;
  return (
    <td className="whitespace-normal! [&:has(*)]:h-auto! [&:has(*)]:py-1.5!">
      <span className={`inline-flex items-center gap-1.5 ${tone}`}><Icon name={info.icon} />{word}</span>
      {children}
    </td>
  );
}

// Load error, empty line, or the table (from `children`) with its pager.
export function PagedTable<Row>({ rows, empty, children }: {
  rows: PagedRows<Row>;
  empty: string;
  children: (items: Row[]) => React.ReactNode;
}) {
  const { data, error, page, setPage } = rows;
  return (
    <>
      {error && <p role="alert" className="text-body font-semibold text-red">{error}</p>}
      {data && data.total === 0 && <p className="text-body text-muted-foreground">{empty}</p>}
      {data && data.total > 0 && (
        <>
          <div className="tbox">{children(data.items)}</div>
          <Pager total={data.total} page={page} onPage={setPage} />
        </>
      )}
    </>
  );
}
