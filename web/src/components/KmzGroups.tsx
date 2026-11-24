import { Fragment, useId, useState } from "react";
import { Icon } from "@/components/Icon";
import { elementCounts } from "@/lib/format";
import {
  isNewCluster, needsTarget, pickFor,
  type ColourMode, type GroupChoice, type KmzGroup, type Target, type TargetLists,
} from "@/lib/useKmzUpload";

const TARGETS: [Target, string][] = [["segment", "Segment"], ["site", "Site"], ["cluster", "Cluster"], ["skip", "-"]];
const PICK_LABEL: Record<Target, string> = { segment: "Segment", site: "Site", cluster: "Cluster", skip: "" };

type RowProps = {
  group: KmzGroup;
  choice: GroupChoice;
  lists: TargetLists | null;
  onChange: (change: Partial<GroupChoice>) => void;
  fixed?: boolean;
};

// Ready / Needs review with its symbol; a ticked row without a target says what is missing.
function Status({ group, choice, lists }: Omit<RowProps, "onChange">) {
  if (needsTarget(choice, lists)) {
    let missing = "pick a target";
    if (choice.target !== "skip") {
      missing = `pick a ${choice.target} from the list`;
    }
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-amber">
        <Icon name="lo" />Needs review: {missing}
      </span>
    );
  }
  if (group.status === "Needs review" && !choice.included) {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-amber">
        <Icon name="lo" />Needs review: {group.reason}
      </span>
    );
  }
  if (!choice.included) {
    return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Icon name="ns" />Skip</span>;
  }
  return <span className="inline-flex items-center gap-1.5"><Icon name="ch" />Ready</span>;
}

// Type-ahead on the native <datalist>; the name must match one in the list (a cluster name may be new).
function Picker({ group, choice, lists, onChange }: RowProps) {
  const id = useId();
  if (choice.target === "skip") {
    return null;
  }
  let options: { id: number; name: string }[] = [];
  if (lists) {
    options = lists[choice.target];
  }
  let marker = null;
  if (isNewCluster(choice, lists)) {
    marker = <span className="pill h-blue">New</span>;
  }
  return (
    <span className="flex items-center gap-2">
      <input className="field" list={id} value={choice.pick} autoComplete="off"
        aria-label={`${PICK_LABEL[choice.target]} for ${group.name}`}
        aria-invalid={needsTarget(choice, lists)}
        onChange={(event) => onChange({ pick: event.target.value })} />
      <datalist id={id}>{options.map((option) => <option key={option.id} value={option.name} />)}</datalist>
      {marker}
    </span>
  );
}

function Members({ group, choice, lists, onChange }: RowProps) {
  const names = new Map((lists?.site ?? []).map((site) => [site.id, site.name]));
  const toggle = (siteId: number, checked: boolean) => {
    let members = choice.members.filter((member) => member !== siteId);
    if (checked) {
      members = [...members, siteId];
    }
    onChange({ members });
  };
  if (group.member_site_ids.length === 0) {
    return <p className="text-body text-muted-foreground">No site inside this area.</p>;
  }
  return (
    <fieldset>
      <legend className="lbl">Sites in the new cluster</legend>
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {group.member_site_ids.map((siteId) => (
          <li key={siteId}>
            <label className="flex items-center gap-2 text-body">
              <input type="checkbox" checked={choice.members.includes(siteId)}
                onChange={(event) => toggle(siteId, event.target.checked)} />
              {names.get(siteId) ?? `Site ${siteId}`}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function Elements({ group }: { group: KmzGroup }) {
  return (
    <ul className="grid grid-cols-3 gap-x-6 gap-y-0.5 text-body">
      {group.elements.map((element, index) => (
        <li key={`${index}-${element.name}`} className="truncate">
          <span className="font-medium">{element.name || "(no name)"}</span>
          <span className="text-muted-foreground"> {element.kind}</span>
        </li>
      ))}
    </ul>
  );
}

function GroupRow({ group, choice, lists, onChange, fixed }: RowProps) {
  const [open, setOpen] = useState(false);
  const changeTarget = (target: Target) => {
    onChange({ target, included: target !== "skip", pick: pickFor(target, group) });
  };
  const newCluster = isNewCluster(choice, lists) && choice.included;
  let toggleLabel = "Show elements";
  if (open) {
    toggleLabel = "Hide elements";
  }
  return (
    <Fragment>
      <tr data-testid={`kmz-group-${group.name}`}>
        <td>
          <input type="checkbox" checked={choice.included} aria-label={`Include ${group.name}`}
            onChange={(event) => onChange({ included: event.target.checked })} />
        </td>
        <th scope="row" className="text-left!">
          <button type="button" className="link font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}
            title={toggleLabel}>
            {group.name}
          </button>
          <span className="block truncate text-xs text-muted-foreground" title={group.folder_path}>
            {group.folder_path}
          </span>
        </th>
        <td className="num">{elementCounts(group.counts)}</td>
        <td className="whitespace-normal! text-left!"><Status group={group} choice={choice} lists={lists} /></td>
        {!fixed && (
          <>
            <td>
              <select className="field" value={choice.target} aria-label={`Target for ${group.name}`}
                onChange={(event) => changeTarget(event.target.value as Target)}>
                {TARGETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </td>
            <td><Picker group={group} choice={choice} lists={lists} onChange={onChange} /></td>
          </>
        )}
        <td>
          <select className="field" value={choice.colourMode} aria-label={`Colours for ${group.name}`}
            onChange={(event) => onChange({ colourMode: event.target.value as ColourMode })}>
            <option value="theme">Theme</option>
            <option value="kmz">KMZ colours</option>
          </select>
        </td>
      </tr>
      {(open || newCluster) && (
        <tr>
          <td />
          <td colSpan={fixed ? 4 : 6} className="h-auto! space-y-2 py-2! text-left!">
            {open && <Elements group={group} />}
            {newCluster && <Members group={group} choice={choice} lists={lists} onChange={onChange} />}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// `fixed`: the target is set by the caller, so the Target and Attach to columns are left out.
export function KmzGroups({ groups, choices, lists, onChange, fixed }: {
  groups: KmzGroup[];
  choices: Record<string, GroupChoice>;
  lists: TargetLists | null;
  onChange: (key: string, change: Partial<GroupChoice>) => void;
  fixed?: boolean;
}) {
  return (
    <div className="tbox">
      <table className="tbl band" aria-label="Folders">
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-44" />
          <col className="w-64" />
          {!fixed && <col className="w-32" />}
          {!fixed && <col className="w-64" />}
          <col className="w-36" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Include</span></th>
            <th scope="col" className="text-left!">Folder</th>
            <th scope="col">Elements</th>
            <th scope="col" className="text-left!">Status</th>
            {!fixed && <th scope="col">Target</th>}
            {!fixed && <th scope="col">Attach to</th>}
            <th scope="col">Colours</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupRow key={group.key} group={group} choice={choices[group.key]} lists={lists}
              onChange={(change) => onChange(group.key, change)} fixed={fixed} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
