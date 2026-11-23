import { Fragment, useState } from "react";
import { SitePicker } from "@/components/AdminEdit";
import { Note } from "@/components/upload-parts";
import { plural } from "@/lib/format";
import type { Site } from "@/lib/useAdminEdit";
import { useClusters, useMapGroups, type Cluster } from "@/lib/useKmzEdit";

type Edits = ReturnType<typeof useClusters>;

// The cluster's area folders, each with Hide/Show.
function Areas({ cluster, onError }: { cluster: Cluster; onError: (message: string | null) => void }) {
  const { groups, change } = useMapGroups({ kind: "cluster", id: cluster.id }, onError);
  if (!groups || groups.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-1">
      {groups.map((group) => {
        let label = "Hide";
        if (group.hidden) {
          label = "Show";
        }
        return (
          <li key={group.id} className="flex items-center gap-2">
            <span>{group.name}</span>
            {group.hidden && <span className="pill h-ns">Hidden</span>}
            <button type="button" className="btn btn-sm" aria-label={`${label} ${group.name}`}
              onClick={() => change(group.id, { hidden: !group.hidden })}>
              {label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Name({ cluster, edits }: { cluster: Cluster; edits: Edits }) {
  const [text, setText] = useState<string | null>(null);
  if (text === null) {
    return (
      <span className="flex items-center gap-2">
        <span className="font-semibold">{cluster.name}</span>
        <button type="button" className="btn btn-sm" aria-label={`Rename ${cluster.name}`}
          onClick={() => setText(cluster.name)}>
          Rename
        </button>
      </span>
    );
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    await edits.rename(cluster.id, text);
    setText(null);
  };
  return (
    <form className="flex items-center gap-2" onSubmit={save}>
      <input className="field" autoFocus value={text} aria-label={`New name for ${cluster.name}`}
        onChange={(event) => setText(event.target.value)} />
      <button type="submit" className="btn btn-sm btn-p" disabled={!text.trim()}>Save</button>
      <button type="button" className="btn btn-sm" onClick={() => setText(null)}>Cancel</button>
    </form>
  );
}

function Members({ cluster, edits }: { cluster: Cluster; edits: Edits }) {
  const [site, setSite] = useState<Site | null>(null);
  const [round, setRound] = useState(0);
  const add = async () => {
    if (!site) {
      return;
    }
    await edits.addSite(cluster.id, site.id);
    setSite(null);
    setRound(round + 1);
  };
  return (
    <div className="space-y-3">
      {cluster.sites.length === 0 ? <p className="text-muted-foreground">No sites</p> : (
        <ul aria-label={`Sites in ${cluster.name}`} className="space-y-1">
          {cluster.sites.map((member) => (
            <li key={member.id} className="flex items-center gap-2">
              <span>{member.name}</span>
              <button type="button" className="btn btn-sm" aria-label={`Remove ${member.name}`}
                onClick={() => edits.removeSite(cluster.id, member.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2">
        <div className="w-80">
          <SitePicker key={round} label="Add site" site={site} onPick={setSite} />
        </div>
        <button type="button" className="btn mt-6" disabled={!site} onClick={add}>Add</button>
      </div>
    </div>
  );
}

function ClusterRow({ cluster, edits }: { cluster: Cluster; edits: Edits }) {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr data-testid={`cluster-${cluster.name}`}>
        <td>
          <button type="button" className="link" aria-expanded={open} aria-label={`Sites of ${cluster.name}`}
            onClick={() => setOpen(!open)}>
            Sites
          </button>
        </td>
        <td className="text-left!"><Name cluster={cluster} edits={edits} /></td>
        <td className="num">{plural(cluster.sites.length, "site")}</td>
        <td className="whitespace-normal! text-left!"><Areas cluster={cluster} onError={edits.setError} /></td>
      </tr>
      {open && (
        <tr>
          <td />
          <td colSpan={3} className="h-auto! py-3! text-left!"><Members cluster={cluster} edits={edits} /></td>
        </tr>
      )}
    </Fragment>
  );
}

// Clusters screen (admin, Upload area): each cluster with its sites and area folders.
export function Clusters() {
  const edits = useClusters();
  const { clusters, error } = edits;
  return (
    <section className="card space-y-4" aria-labelledby="clusters-h">
      <div className="card-h">
        <h2 id="clusters-h">Clusters</h2>
      </div>
      {error && <Note tone="red" role="alert" title={error} />}
      {clusters && clusters.length === 0 && <p className="text-body text-muted-foreground">No clusters</p>}
      {clusters && clusters.length > 0 && (
        <div className="tbox">
          <table className="tbl band" aria-label="Clusters">
            <colgroup>
              <col className="w-20" />
              <col />
              <col className="w-28" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Expand</span></th>
                <th scope="col" className="text-left!">Cluster</th>
                <th scope="col">Sites</th>
                <th scope="col" className="text-left!">Areas</th>
              </tr>
            </thead>
            <tbody>
              {clusters.map((cluster) => <ClusterRow key={cluster.id} cluster={cluster} edits={edits} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
