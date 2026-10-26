import { sql } from "drizzle-orm";
import { getDb } from "@kds/db";

/**
 * Live snapshot for the manager Overview. Deliberately a "right now" view
 * (open/late/blocked counts plus rolling 24h averages), not a historical report.
 */
export async function getOverview(storeId: string) {
  const db = getDb();
  const one = async <T>(q: ReturnType<typeof sql>) => ((await db.execute(q)).rows[0] ?? {}) as T;

  const counts = await one<{ open: number; due30: number; late: number; ready: number }>(sql`
    select
      count(*)::int as open,
      count(*) filter (where promised_at between now() and now() + interval '30 minutes')::int as due30,
      count(*) filter (where promised_at < now())::int as late,
      count(*) filter (where status in ('READY','STAGED'))::int as ready
    from orders where store_id = ${storeId} and status not in ('COMPLETED','CANCELLED')`);

  const blocked = await one<{ on_hold: number; waiting: number }>(sql`
    select
      count(*) filter (where t.status = 'ON_HOLD')::int as on_hold,
      count(*) filter (where t.status = 'BLOCKED')::int as waiting
    from tasks t join orders o on o.id = t.order_id
    where t.store_id = ${storeId} and o.status not in ('COMPLETED','CANCELLED')`);

  const qc = await one<{ total: number; fails: number }>(sql`
    select count(*)::int as total, count(*) filter (where q.result = 'FAIL')::int as fails
    from qc_inspections q
    join order_items i on i.id = q.order_item_id
    join orders o on o.id = i.order_id
    where o.store_id = ${storeId} and q.created_at > now() - interval '24 hours'`);

  const throughput = await one<{ completed: number; on_time: number; avg_lead_min: number | null }>(sql`
    select count(*)::int as completed,
      count(*) filter (where completed_at <= promised_at)::int as on_time,
      round(avg(extract(epoch from (completed_at - created_at)) / 60)::numeric, 1)::float as avg_lead_min
    from orders where store_id = ${storeId} and status = 'COMPLETED' and completed_at > now() - interval '24 hours'`);

  const stations = (
    await db.execute(sql`
      select s.id, s.name,
        count(t.id) filter (where t.status in ('READY','CLAIMED','IN_PROGRESS','ON_HOLD'))::int as open,
        count(t.id) filter (where t.status = 'DONE' and t.completed_at > now() - interval '24 hours')::int as done24,
        round(avg(extract(epoch from (t.completed_at - t.started_at)))
          filter (where t.status = 'DONE' and t.completed_at > now() - interval '24 hours')::numeric, 0)::int as avg_cycle_sec,
        round(avg(t.duration_sec) filter (where t.status = 'DONE' and t.completed_at > now() - interval '24 hours')::numeric, 0)::int as avg_target_sec
      from stations s
      left join tasks t on t.station_id = s.id
      where s.store_id = ${storeId}
      group by s.id, s.name, s.sort_order
      order by s.sort_order`)
  ).rows as { id: string; name: string; open: number; done24: number; avg_cycle_sec: number | null; avg_target_sec: number | null }[];

  return {
    openOrders: counts.open ?? 0,
    dueWithin30: counts.due30 ?? 0,
    late: counts.late ?? 0,
    readyForHandoff: counts.ready ?? 0,
    tasksOnHold: blocked.on_hold ?? 0,
    tasksWaiting: blocked.waiting ?? 0,
    qcInspections24h: qc.total ?? 0,
    qcFailRate24h: qc.total ? qc.fails / qc.total : null,
    completed24h: throughput.completed ?? 0,
    onTimeRate24h: throughput.completed ? throughput.on_time / throughput.completed : null,
    avgLeadMin24h: throughput.avg_lead_min ?? null,
    stations,
    generatedAt: new Date().toISOString(),
  };
}
