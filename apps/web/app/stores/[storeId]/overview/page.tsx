import { getOverview } from "@kds/domain";
import { LiveRefresh } from "@/components/LiveRefresh";
import { fmtDuration, fmtTime } from "@/lib/format";
import { pageAuth } from "@/lib/pages";

export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export default async function OverviewPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const auth = await pageAuth(storeId, "MANAGER");
  if (!auth.allowed) return <main className="center-msg">Overview requires the MANAGER role or higher.</main>;
  const o = await getOverview(storeId);
  const kpis = [
    { label: "Open orders", value: o.openOrders },
    { label: "Due within 30 min", value: o.dueWithin30, tone: o.dueWithin30 ? "warn" : "" },
    { label: "Late", value: o.late, tone: o.late ? "bad" : "good" },
    { label: "Ready / staged", value: o.readyForHandoff },
    { label: "Tasks on hold", value: o.tasksOnHold, tone: o.tasksOnHold ? "warn" : "" },
    { label: "Tasks waiting on deps", value: o.tasksWaiting },
    { label: "QC fail rate (24h)", value: pct(o.qcFailRate24h), sub: `${o.qcInspections24h} inspections` },
    { label: "Completed (24h)", value: o.completed24h, sub: `${pct(o.onTimeRate24h)} on time` },
    { label: "Avg lead time (24h)", value: o.avgLeadMin24h == null ? "—" : `${o.avgLeadMin24h}m`, sub: "order created → handed off" },
  ];
  return (
    <main className="page">
      <div className="page-head">
        <h1>Overview</h1>
        <div className="head-stats">
          <span className="muted small">Live snapshot · {fmtTime(o.generatedAt, auth.store!.timezone)}</span>
          <LiveRefresh storeId={storeId} everyMs={15_000} />
        </div>
      </div>
      <div className="kpis">
        {kpis.map((k) => (
          <div key={k.label} className={`kpi ${k.tone ?? ""}`}>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-label">{k.label}</div>
            {k.sub && <div className="muted small">{k.sub}</div>}
          </div>
        ))}
      </div>
      <h2>Stations</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Station</th>
            <th>Open tasks</th>
            <th>Done (24h)</th>
            <th>Avg cycle</th>
            <th>Avg target</th>
          </tr>
        </thead>
        <tbody>
          {o.stations.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.open}</td>
              <td>{s.done24}</td>
              <td className={s.avg_cycle_sec != null && s.avg_target_sec != null && s.avg_cycle_sec > s.avg_target_sec ? "over" : ""}>
                {fmtDuration(s.avg_cycle_sec)}
              </td>
              <td className="muted">{fmtDuration(s.avg_target_sec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
