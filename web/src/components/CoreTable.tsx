import type { components } from "@/api/schema";
import { STATUS } from "@/lib/status";

export function CoreTable({ cores }: { cores: components["schemas"]["CoreDetail"][] }) {
  const th = "px-2 py-1.5 text-left font-medium";
  const td = "px-2 py-1.5";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Cores</caption>
        <thead className="border-b"><tr>
          {["Core", "Status", "Customer", "Circuit ID", "Planned date", "Port A", "Port B"].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {cores.map((c) => (
            <tr key={c.id} className="border-b">
              <th scope="row" className={td + " text-left"}>{c.number}</th>
              <td className={td}><span aria-hidden>{STATUS[c.status].symbol}</span> {c.status}</td>
              <td className={td}>{c.customer ?? "-"}</td>
              <td className={td}>{c.circuit_id ?? "-"}</td>
              <td className={td}>{c.planned_date ?? "-"}</td>
              <td className={td}>{c.port_a ?? "-"}</td>
              <td className={td}>{c.port_b ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
