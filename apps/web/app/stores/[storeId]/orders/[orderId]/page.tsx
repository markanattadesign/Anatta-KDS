import Link from "next/link";
import { notFound } from "next/navigation";
import { DomainError, getOrderDetail } from "@kds/domain";
import { LiveRefresh } from "@/components/LiveRefresh";
import { fmtDateTime, fmtDuration, label } from "@/lib/format";
import { pageAuth } from "@/lib/pages";
import { CancelOrderButton } from "./CancelOrderButton";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ storeId: string; orderId: string }> }) {
  const { storeId, orderId } = await params;
  const auth = await pageAuth(storeId, "MANAGER");
  if (!auth.allowed) return <main className="center-msg">Order details require the MANAGER role or higher.</main>;
  let d: Awaited<ReturnType<typeof getOrderDetail>>;
  try {
    d = await getOrderDetail(storeId, orderId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const tz = auth.store!.timezone;
  const o = d.order;
  const open = o.status !== "COMPLETED" && o.status !== "CANCELLED";

  return (
    <main className="page">
      <Link href={`/stores/${storeId}/orders`} className="muted small">
        ← All orders
      </Link>
      <div className="page-head">
        <h1>
          Order #{o.number} <span className={`chip chip-${o.status.toLowerCase()}`}>{label(o.status)}</span>
        </h1>
        <div className="head-stats">
          {open && <CancelOrderButton storeId={storeId} orderId={o.id} number={o.number} />}
          <LiveRefresh storeId={storeId} />
        </div>
      </div>
      <div className="detail-grid">
        <section className="card">
          <h3>Summary</h3>
          <dl className="dl">
            <dt>Customer</dt>
            <dd>{o.customerName}</dd>
            <dt>Fulfillment</dt>
            <dd>{label(o.fulfillmentType)}</dd>
            <dt>Promised</dt>
            <dd>{fmtDateTime(o.promisedAt, tz)}</dd>
            <dt>Source</dt>
            <dd>
              {label(o.source)}
              {o.externalId && <span className="muted"> · {o.externalId}</span>}
            </dd>
            <dt>Allergens</dt>
            <dd>{o.allergens.length ? o.allergens.map(label).join(", ") : "None"}</dd>
            {o.notes && (
              <>
                <dt>Notes</dt>
                <dd>{o.notes}</dd>
              </>
            )}
            {o.stagingLocation && (
              <>
                <dt>Staged</dt>
                <dd>
                  {o.packageCount} pkg at {o.stagingLocation}
                </dd>
              </>
            )}
          </dl>
          <h3>Items</h3>
          {d.items.map((i) => (
            <div key={i.id} className="item-block">
              <b>
                {i.quantity}× {i.name}
              </b>{" "}
              <span className={`chip chip-${i.status.toLowerCase()}`}>{label(i.status)}</span>
              <span className="muted small"> · QC attempts: {i.qcAttempts}</span>
              <table className="table compact">
                <tbody>
                  {d.tasks
                    .filter((t) => t.task.orderItemId === i.id)
                    .map(({ task, stationName, claimedByName }) => (
                      <tr key={task.id}>
                        <td>
                          {task.isRework && <span className="chip chip-rework">Rework</span>} {task.name}
                        </td>
                        <td className="muted">{stationName}</td>
                        <td>
                          <span className={`chip chip-${task.status.toLowerCase()}`}>{label(task.status)}</span>
                        </td>
                        <td className="muted">{claimedByName ?? ""}</td>
                        <td className="muted">
                          {task.startedAt && task.completedAt
                            ? fmtDuration((task.completedAt.getTime() - task.startedAt.getTime()) / 1000)
                            : ""}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
        <section className="card">
          <h3>Timeline</h3>
          <ol className="timeline">
            {d.events.map(({ event, actorName }) => (
              <li key={event.id}>
                <span className="muted small">{fmtDateTime(event.createdAt, tz)}</span>
                <div>
                  <b>{label(event.type)}</b>
                  {actorName && <span className="muted"> · {actorName}</span>}
                </div>
                <EventData data={event.data} />
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}

function EventData({ data }: { data: Record<string, unknown> }) {
  const parts = Object.entries(data)
    .filter(([k, v]) => v !== undefined && v !== null && v !== "" && !k.endsWith("Id"))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.map(String).join(", ") : String(v)}`);
  return parts.length ? <div className="muted small">{parts.join(" · ")}</div> : null;
}
