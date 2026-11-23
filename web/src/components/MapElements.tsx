import { useEffect, useId, useState } from "react";
import { KmzUpload } from "@/components/KmzUpload";
import { Dialog } from "@/components/upload-parts";
import { elementCounts, formatDateTime } from "@/lib/format";
import { useMapGroups, type GroupPatch, type MapGroup } from "@/lib/useKmzEdit";
import { loadTargetLists, type FixedTarget, type TargetLists } from "@/lib/useKmzUpload";

type MoveKind = keyof TargetLists;
const MOVE_KINDS: [MoveKind, string][] = [["segment", "Segment"], ["site", "Site"], ["cluster", "Cluster"]];

// Move a group to another segment, site or cluster, picked by name from the list.
function MoveRow({ group, onMove, onError }: {
  group: MapGroup; onMove: (body: GroupPatch) => void; onError: (message: string | null) => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<MoveKind>("segment");
  const [text, setText] = useState("");
  const [lists, setLists] = useState<TargetLists | null>(null);
  useEffect(() => {
    loadTargetLists().then(setLists).catch(() => onError("Could not load the targets."));
  }, [onError]);
  const options = lists?.[kind] ?? [];
  const picked = options.find((option) => option.name === text.trim());
  const move = () => {
    if (picked) {
      onMove({ target: { kind, id: picked.id } });
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select className="field w-32" value={kind} aria-label={`Move ${group.name} to`}
        onChange={(event) => setKind(event.target.value as MoveKind)}>
        {MOVE_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <input className="field min-w-0 flex-1" list={id} value={text} autoComplete="off"
        aria-label={`${MOVE_KINDS.find(([value]) => value === kind)?.[1]} for ${group.name}`}
        onChange={(event) => setText(event.target.value)} />
      <datalist id={id}>{options.map((option) => <option key={option.id} value={option.name} />)}</datalist>
      <button type="button" className="btn" disabled={!picked} onClick={move}>Move</button>
    </div>
  );
}

function GroupItem({ group, change, onError }: {
  group: MapGroup; change: (groupId: number, body: GroupPatch) => void; onError: (message: string | null) => void;
}) {
  const [moving, setMoving] = useState(false);
  const save = (body: GroupPatch) => change(group.id, body);
  let hideLabel = "Hide";
  if (group.hidden) {
    hideLabel = "Show";
  }
  return (
    <li className="border-b border-rule py-2 last:border-b-0" data-testid={`map-group-${group.name}`}>
      <p className="flex items-center gap-2">
        <span className="font-semibold">{group.name}</span>
        {group.hidden && <span className="pill h-ns">Hidden</span>}
      </p>
      <p className="text-body text-muted-foreground">
        {elementCounts(group.counts)} · {group.upload.filename}, {formatDateTime(group.upload.created_at)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="btn" aria-label={`${hideLabel} ${group.name}`}
          onClick={() => save({ hidden: !group.hidden })}>
          {hideLabel}
        </button>
        <select className="field w-40" value={group.colour_mode} aria-label={`Colours for ${group.name}`}
          onChange={(event) => save({ colour_mode: event.target.value as GroupPatch["colour_mode"] })}>
          <option value="theme">Theme</option>
          <option value="kmz">KMZ colours</option>
        </select>
        <button type="button" className="btn" aria-expanded={moving} onClick={() => setMoving(!moving)}>Move</button>
      </div>
      {moving && <MoveRow group={group} onMove={save} onError={onError} />}
    </li>
  );
}

// "Map elements" of an edit box: the KMZ folders attached to this segment or site. Changes save at once.
export function MapElements({ owner, onError }: { owner: FixedTarget; onError: (message: string | null) => void }) {
  const { groups, change, reload } = useMapGroups(owner, onError);
  const [adding, setAdding] = useState(false);
  const closeAdd = () => {
    setAdding(false);
    reload();
  };
  return (
    <section className="mt-4 border-t pt-3 text-body" aria-labelledby={`map-elements-${owner.kind}`}>
      <div className="flex items-center justify-between">
        <h3 id={`map-elements-${owner.kind}`} className="font-semibold">Map elements</h3>
        <button type="button" className="btn" onClick={() => setAdding(true)}>Add from KMZ</button>
      </div>
      {groups && groups.length === 0 && <p className="mt-2 text-muted-foreground">No map elements</p>}
      {groups && groups.length > 0 && (
        <ul className="mt-1">
          {groups.map((group) => <GroupItem key={group.id} group={group} change={change} onError={onError} />)}
        </ul>
      )}
      {adding && (
        <Dialog title={`Add from KMZ to ${owner.name}`} onClose={closeAdd} cls="m-auto w-[1100px] max-w-[95vw]">
          <div className="mt-4">
            <KmzUpload fixed={owner} />
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" className="btn" onClick={closeAdd}>Close</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
