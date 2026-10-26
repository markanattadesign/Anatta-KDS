import Link from "next/link";
import { ORDER_STATUSES, type OrderStatus } from "@kds/contracts";
import { listOrders } from "@kds/domain";
import { LiveRefresh } from "@/components/LiveRefresh";
import { fmtDateTime, label } from "@/lib/format";
import { pageAuth } from "@/lib/pages";
import { NewOrderButton } from "./NewOrderButton";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { storeId } = await params;
  const { status } = await searchParams;
  const auth = await pageAuth(storeId, "MANAGER");
  if (!auth.allowed) return <main className="center-msg">Orders require the MANAGER role or higher.</main>;
  const filter = ORDER_STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined;
  const orders = await listOrders(storeId, { status: filter });
  const tz = auth.store!.timezone;
  const base = `/stores/${storeId}/orders`;

  return (
    <main className="page">
      <div className="page-head">
        <h1>Orders</h1>
        <div className="head-stats">
          <NewOrderButton storeId={storeId} />
          <LiveRefresh storeId={storeId} />
        </div>
      </div>
      <div className="filters">
        <Link href={base} className={`chip-link ${!filter ? "active" : ""}`}>
          All
        </Link>
        {ORDER_STATUSES.map((s) => (
          <Link key={s} href={`${base}?status=${s}`} className={`chip-link ${filter === s ? "active" : ""}`}>
            {label(s)}
          </Link>
        ))}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Customer</th>
            <th>Type</th>
            <th>Source</th>
            <th>Items</th>
            <th>Promised</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>
                <Link href={`${base}/${o.id}`}>
                  <b>#{o.number}</b>
                </Link>
              </td>
              <td>{o.customerName}</td>
              <td>{label(o.fulfillmentType)}</td>
              <td className="muted">{label(o.source)}</td>
              <td>{o.itemCount}</td>
              <td>{fmtDateTime(o.promisedAt, tz)}</td>
              <td>
                <span className={`chip chip-${o.status.toLowerCase()}`}>{label(o.status)}</span>
              </td>
              <td className="muted">{fmtDateTime(o.createdAt, tz)}</td>
            </tr>
          ))}
          {!orders.length && (
            <tr>
              <td colSpan={8} className="muted">
                No orders yet. Create one, or run <code>npm run simulate</code>.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
