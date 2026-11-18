import { useState, type MouseEvent } from "react";
import type { components } from "@/api/schema";
import { Icon } from "@/components/Icon";
import { Blank } from "@/components/LossCard";
import { segmentName, STATUS, statusLabel, type CoreStatus } from "@/lib/status";

type Detail = components["schemas"]["SegmentDetail"];
type Core = Detail["cores"][number];
type Hold = Detail["unassigned"][number];
type Row = { key: string; cores: Core[]; hold?: Hold };
type GroupKey = CoreStatus | "Unassigned";
type Group = { status: GroupKey; count: number; rows: Row[] };

const ORDER: GroupKey[] = ["Requested", "Reserved", "In use", "Unassigned", "Available"];
const COLUMN_NAMES = ["Cores", "Customer", "Planner", "SRF", "Planned", "Days held", "Ports"];
const STATUS_WORD_CLASS = "inline-flex items-center gap-2 font-semibold whitespace-nowrap";

function unassignedGroup(detail: Detail): Group {
  const count = detail.unassigned.reduce((total, hold) => total + hold.remaining, 0);
  const rows = detail.unassigned.map((hold) => ({ key: `u${hold.reservation_id}`, cores: [], hold }));
  return { status: "Unassigned", count, rows };
}

function statusGroup(detail: Detail, status: CoreStatus): Group {
  const cores = detail.cores
    .filter((core) => core.status === status)
    .sort((first, second) => first.number - second.number);
  const rows = cores.map((core) => ({ key: `c${core.id}`, cores: [core] }));
  return { status, count: cores.length, rows };
}

// One group per status, holders first, Available last; empty groups are left out. One row per core.
function groupCores(detail: Detail): Group[] {
  const groups = ORDER.map((status) => {
    if (status === "Unassigned") {
      return unassignedGroup(detail);
    }
    return statusGroup(detail, status);
  });
  return groups.filter((group) => group.rows.length);
}

const hasCore = (group: Group, test: (core: Core) => boolean) =>
  group.rows.some((row) => row.cores.some(test));

const coresWord = (count: number) => (count === 1 ? "core" : "cores");

const Dash = () => <Blank>-</Blank>;

function Ports({ core }: { core: Core }) {
  if (!core.port_a && !core.port_b) {
    return <Blank>No ports yet</Blank>;
  }
  return <>{core.port_a ?? <Dash />} to {core.port_b ?? <Dash />}</>;
}

function StatusWord({ status, count }: { status: GroupKey; count?: number }) {
  if (status === "Unassigned") {
    return <span className={`${STATUS_WORD_CLASS} text-use`}><Icon name="co" />Unassigned</span>;
  }
  const look = STATUS[status];
  return (
    <span className={`${STATUS_WORD_CLASS} ${look.tone}`}>
      <span aria-hidden className={`core sw cursor-[inherit] ${look.cls}`}><Icon name={look.icon} /></span>
      {statusLabel(status)}{count != null && count > 1 && ` (${count})`}
    </span>
  );
}

function Stale({ core }: { core: Core }) {
  if (!core.stale) {
    return null;
  }
  const since = core.stale_since ?? "-";
  return (
    <span className="pill h-amber ml-2" title={`No keep for over 3 months since ${since}`}>
      <Icon name="lo" />Stale<span className="sr-only">: no keep for over 3 months since {since}</span>
    </span>
  );
}

// Groups closed by the user. Available starts closed unless it holds the focused core;
// a new flash (request just sent) opens the group that holds it.
function useClosedGroups(groups: Group[], focusCoreId: number | null, flash: number | null | undefined) {
  const [closed, setClosed] = useState<Set<GroupKey>>(() => {
    const availableHidesNothing = groups.some(
      (group) => group.status === "Available" && !hasCore(group, (core) => core.id === focusCoreId),
    );
    return new Set(availableHidesNothing ? ["Available"] : []);
  });
  const [seenFlash, setSeenFlash] = useState(flash);
  if (flash !== seenFlash) {
    setSeenFlash(flash);
    const flashed = flash != null && groups.find((group) => hasCore(group, (core) => core.reservation_id === flash));
    if (flashed && closed.has(flashed.status)) {
      setClosed((current) => {
        const next = new Set(current);
        next.delete(flashed.status);
        return next;
      });
    }
  }
  const toggleGroup = (key: GroupKey) => {
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  };
  return { closed, toggleGroup };
}

type CoresTableProps = {
  detail: Detail;
  focusCoreId: number | null;
  onOpen: (core: Core) => void;
  onAssign: ((hold: Hold) => void) | null;
  flash?: number | null; // reservation id just requested: its row is highlighted briefly
};

// The one Cores table: a group per status with its count in the group header (the only place counts appear);
// Available starts collapsed. One row per core.
export function CoresTable({ detail, focusCoreId, flash, onOpen, onAssign }: CoresTableProps) {
  const groups = groupCores(detail);
  const { closed, toggleGroup } = useClosedGroups(groups, focusCoreId, flash);
  return (
    <table className="tbl">
      <caption className="sr-only">Cores of {segmentName(detail)}</caption>
      {/* Shared widths so the columns line up down every group. */}
      <colgroup>
        <col className="w-[11%]" />
        <col className="w-[18%]" />
        <col className="w-[13%]" />
        <col className="w-[11%]" />
        <col className="w-[11%]" />
        <col className="w-[14%]" />
        <col />
      </colgroup>
      {groups.map((group) => (
        <CoreGroup key={group.status} group={group} shut={closed.has(group.status)}
          onToggle={() => toggleGroup(group.status)} focusCoreId={focusCoreId} flash={flash}
          onOpen={onOpen} onAssign={onAssign} />
      ))}
    </table>
  );
}

type CoreGroupProps = Omit<CoresTableProps, "detail"> & { group: Group; shut: boolean; onToggle: () => void };

function groupCountText(group: Group): string {
  if (group.status === "Unassigned") {
    return `${group.count} ${coresWord(group.count)}`;
  }
  return String(group.count);
}

function CoreGroup({ group, shut, onToggle, focusCoreId, flash, onOpen, onAssign }: CoreGroupProps) {
  return (
    <tbody data-testid="core-group" data-status={group.status}>
      <tr>
        <th colSpan={7} scope="rowgroup" className="grp">
          <button type="button" className="inline-flex cursor-pointer items-center gap-2" aria-expanded={!shut}
            onClick={onToggle}>
            <span aria-hidden className="w-4 text-lg leading-none text-muted-foreground">
              {shut ? "▸" : "▾"}
            </span>
            <StatusWord status={group.status} />
            <span className="font-semibold tabular-nums">{groupCountText(group)}</span>
          </button>
        </th>
      </tr>
      {!shut && <ColumnHead available={group.status === "Available"} />}
      {!shut && group.rows.map((row) => {
        if (row.hold) {
          return <UnassignedRow key={row.key} hold={row.hold} onAssign={onAssign} />;
        }
        return (
          <CoreRow key={row.key} core={row.cores[0]} focusCoreId={focusCoreId} flash={flash} onOpen={onOpen} />
        );
      })}
    </tbody>
  );
}

// Available rows leave the middle columns empty: those columns never hold anything for a free core.
function ColumnHead({ available }: { available: boolean }) {
  if (available) {
    return <tr className="colhead"><th scope="col">Cores</th><td colSpan={5} /><th scope="col">Ports</th></tr>;
  }
  return (
    <tr className="colhead">
      {COLUMN_NAMES.map((name) => <th key={name} scope="col">{name}</th>)}
    </tr>
  );
}

function UnassignedRow({ hold, onAssign }: { hold: Hold; onAssign: ((hold: Hold) => void) | null }) {
  return (
    <tr data-testid="unassigned-row">
      <th scope="row" className="font-semibold">{hold.remaining} {coresWord(hold.remaining)}</th>
      <td className="truncate" title={hold.customer ?? undefined}>{hold.customer ?? <Dash />}</td>
      <td className="truncate" title={hold.planner ?? undefined}>{hold.planner ?? <Dash />}</td>
      <td className="truncate" title={hold.srf_id ?? undefined}>{hold.srf_id ?? <Dash />}</td>
      <td className="whitespace-nowrap">{hold.planned_date ?? <Dash />}</td>
      <td className="num">{hold.age_days}</td>
      <td>
        {onAssign ? (
          <button type="button" className="btn btn-sm" onClick={() => onAssign(hold)}>Assign cores</button>
        ) : (
          <Blank>No ports yet</Blank>
        )}
      </td>
    </tr>
  );
}

function HolderCells({ core }: { core: Core }) {
  return (
    <>
      <td className="truncate" title={core.customer ?? undefined}>{core.customer || <Dash />}</td>
      <td className="truncate" title={core.planner ?? undefined}>{core.planner || <Dash />}</td>
      <td className="truncate" title={core.srf_id ?? undefined}>{core.srf_id || <Dash />}</td>
      <td className="whitespace-nowrap">{core.planned_date || <Dash />}</td>
      <td className="num">{core.age_days ?? <Dash />}<Stale core={core} /></td>
    </>
  );
}

type CoreRowProps = Pick<CoresTableProps, "focusCoreId" | "flash" | "onOpen"> & { core: Core };

function CoreRow({ core, focusCoreId, flash, onOpen }: CoreRowProps) {
  const flashed = flash != null && core.reservation_id === flash;
  const rowClass = [
    "cursor-pointer hover:bg-raised",
    core.status === "Requested" ? "bg-amber-bg" : "",
    core.id === focusCoreId ? "bg-blue-bg" : "",
    flashed ? "flash" : "",
  ].join(" ");
  const openFromButton = (event: MouseEvent) => {
    event.stopPropagation();
    onOpen(core);
  };
  return (
    <tr onClick={() => onOpen(core)} className={rowClass} data-core={core.number} data-flash={flashed || undefined}>
      <th scope="row" className="font-semibold">
        <button type="button" className="cursor-pointer font-semibold" aria-label={`Core ${core.number} details`}
          onClick={openFromButton}>
          {core.number}
        </button>
      </th>
      {core.status === "Available" ? <td colSpan={5} /> : <HolderCells core={core} />}
      <td className="truncate"><Ports core={core} /></td>
    </tr>
  );
}
