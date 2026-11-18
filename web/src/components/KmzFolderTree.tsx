import type { FolderNode } from "@/lib/useKmzUpload";

type TreeProps = {
  nodes: FolderNode[];
  selected: Set<string>;
  onToggle: (node: FolderNode, ancestorIds: string[], checked: boolean) => void;
};

function FolderList({ nodes, ancestorIds, selected, onToggle }: TreeProps & { ancestorIds: string[] }) {
  const childAncestors = (node: FolderNode) => [...ancestorIds, node.id];
  return (
    <ul className={ancestorIds.length > 0 ? "pl-6" : ""}>
      {nodes.map((node) => (
        <li key={node.id}>
          <label className="flex items-center gap-2 py-1 text-body">
            <input type="checkbox" checked={selected.has(node.id)} disabled={node.lines === 0}
              onChange={(event) => onToggle(node, ancestorIds, event.target.checked)} />
            <span className="font-medium">{node.name}</span>
            <span className="text-muted-foreground">{node.lines} {node.lines === 1 ? "line" : "lines"}</span>
          </label>
          {node.children.length > 0 && (
            <FolderList nodes={node.children} ancestorIds={childAncestors(node)}
              selected={selected} onToggle={onToggle} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function KmzFolderTree(props: TreeProps) {
  return (
    <fieldset>
      <legend className="mb-1 font-medium text-body">Folders</legend>
      <FolderList {...props} ancestorIds={[]} />
    </fieldset>
  );
}
