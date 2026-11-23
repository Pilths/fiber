import { useState } from "react";
import { elementCounts } from "@/lib/format";
import type { FolderNode } from "@/lib/useKmzUpload";

type TreeProps = {
  nodes: FolderNode[];
  selected: Set<string>;
  onToggle: (node: FolderNode, ancestorIds: string[], checked: boolean) => void;
};

type ListProps = TreeProps & {
  ancestorIds: string[];
  closed: Set<string>;
  onOpenClose: (id: string) => void;
};

function Chevron({ open }: { open: boolean }) {
  let turn = "";
  if (open) {
    turn = "rotate-90";
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`ic transition-transform ${turn}`}>
      <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FolderList({ nodes, ancestorIds, selected, onToggle, closed, onOpenClose }: ListProps) {
  const childAncestors = (node: FolderNode) => [...ancestorIds, node.id];
  let indent = "clear-left";
  if (ancestorIds.length > 0) {
    indent = "pl-6";
  }
  return (
    <ul className={indent}>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const open = !closed.has(node.id);
        const empty = node.lines + node.areas + node.points === 0;
        return (
          <li key={node.id}>
            <div className="flex items-center gap-1 py-1 text-body">
              {hasChildren ? (
                <button type="button" className="grid size-6 place-items-center rounded hover:bg-raised"
                  aria-expanded={open} aria-label={`Open or close ${node.name}`} onClick={() => onOpenClose(node.id)}>
                  <Chevron open={open} />
                </button>
              ) : (
                <span className="size-6" />
              )}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={selected.has(node.id)} disabled={empty}
                  onChange={(event) => onToggle(node, ancestorIds, event.target.checked)} />
                <span className="font-medium">{node.name}</span>
                <span className="text-muted-foreground">{elementCounts(node)}</span>
              </label>
            </div>
            {hasChildren && open && (
              <FolderList nodes={node.children} ancestorIds={childAncestors(node)}
                selected={selected} onToggle={onToggle} closed={closed} onOpenClose={onOpenClose} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function KmzFolderTree({ onSelectAll, onSelectNone, ...props }: TreeProps & {
  onSelectAll: () => void;
  onSelectNone: () => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const openClose = (id: string) => {
    const next = new Set(closed);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setClosed(next);
  };
  return (
    <fieldset>
      <legend className="float-left mr-3 font-medium text-body leading-8">Folders</legend>
      <div className="mb-1 flex gap-2">
        <button type="button" className="btn btn-sm" onClick={onSelectAll}>Select all</button>
        <button type="button" className="btn btn-sm" onClick={onSelectNone}>None</button>
      </div>
      <FolderList {...props} ancestorIds={[]} closed={closed} onOpenClose={openClose} />
    </fieldset>
  );
}
