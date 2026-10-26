"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AllergenBanner, ConnectionBanner, LiveDot, Modal, StatusChip, useToast } from "@/components/ui";
import { ApiError, api } from "@/lib/client";
import { fmtMinutes, fmtTime, label, urgency } from "@/lib/format";
import type { ExpoOrder, ExpoQueue } from "@/lib/types";
import { useDebounced, useNow, useStoreEvents } from "@/lib/useStoreEvents";

const SHELVES = ["A1", "A2", "A3", "B1", "B2", "B3", "Cooler 1", "Cooler 2", "Driver shelf"];

export function FulfillmentBoard({ storeId, timeZone, canCancel }: { storeId: string; timeZone: string; canCancel: boolean }) {
  const [data, setData] = useState<ExpoQueue | null>(null);
  const [staging, setStaging] = useState<ExpoOrder | null>(null);
  const [cancelled, setCancelled] = useState<Map<string, { order: ExpoOrder; until: number }>>(new Map());
  const ordersRef = useRef<ExpoOrder[]>([]);
  const toast = useToast();
  const now = useNow(5000);

  const load = useCallback(async () => {
    try {
      const q = await api<ExpoQueue>(`/api/stores/${storeId}/fulfillment`);
      setData(q);
      ordersRef.current = q.orders;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load orders");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);
  const reload = useDebounced(load);
  const { connected } = useStoreEvents(storeId, {
    onSync: reload,
    onEvent: (e) => {
      if (e.type === "ORDER_CANCELLED") {
        const o = ordersRef.current.find((x) => x.id === e.payload.orderId);
        if (o) setCancelled((m) => new Map(m).set(o.id, { order: o, until: Date.now() + 20_000 }));
      }
      reload();
    },
  });
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!cancelled.size) return;
    const live = [...cancelled].filter(([, v]) => v.until > now);
    if (live.length !== cancelled.size) setCancelled(new Map(live));
  }, [now, cancelled]);

  async function post(o: ExpoOrder, action: string, body?: unknown, okMsg?: string) {
    try {
      await api(`/api/stores/${storeId}/orders/${o.id}/${action}`, { body: body ?? {} });
      if (okMsg) toast.ok(okMsg);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "That didn't work");
      await load();
    }
  }

  const flash = [...cancelled.values()].map((c) => c.order).filter((o) => !data?.orders.some((x) => x.id === o.id));
  const all = [...flash.map((o) => ({ ...o, _cancelled: true })), ...(data?.orders ?? []).map((o) => ({ ...o, _cancelled: false }))];
  const columns = [
    { key: "PICKUP", title: "Pickup" },
    { key: "DELIVERY", title: "Delivery" },
  ] as const;

  return (
    <main className="board">
      <ConnectionBanner connected={connected} />
      <div className="board-head">
        <h1>Fulfillment</h1>
        <div className="head-stats">
          <span>
            <b>{data?.orders.filter((o) => o.status === "READY").length ?? 0}</b> ready to stage
          </span>
          <span className="muted">{data?.orders.filter((o) => o.status === "STAGED").length ?? 0} staged</span>
          <LiveDot connected={connected} />
        </div>
      </div>
      <div className="columns">
        {columns.map((col) => {
          const list = all.filter((o) => o.fulfillmentType === col.key);
          return (
            <section key={col.key} className="column">
              <h2>
                {col.title} <span className="muted">({list.filter((o) => !o._cancelled).length})</span>
              </h2>
              {!list.length && <p className="muted small">No open {col.title.toLowerCase()} orders.</p>}
              {list.map((o) => {
                const left = new Date(o.promisedAt).getTime() - now;
                return (
                  <article key={o.id} className={`ticket u-${urgency(o.promisedAt, now)}${o._cancelled ? " cancelled" : ""} ${o.status === "READY" || o.status === "STAGED" ? "is-ready" : ""}`}>
                    {o._cancelled && <div className="cancel-banner">CANCELLED</div>}
                    <header className="ticket-head">
                      <span className="ticket-num">#{o.number}</span>
                      <StatusChip status={o.status} />
                      <span className="ticket-due">
                        <b>{left < 0 ? `${fmtMinutes(-left)} late` : `in ${fmtMinutes(left)}`}</b>
                        <span className="muted small"> · {fmtTime(o.promisedAt, timeZone)}</span>
                      </span>
                    </header>
                    <div className="ticket-cust">
                      {o.customerName}
                      {canCancel && (
                        <Link className="muted small" href={`/stores/${storeId}/orders/${o.id}`}>
                          {" "}
                          · details
                        </Link>
                      )}
                    </div>
                    <AllergenBanner allergens={o.allergens} />
                    <ul className="items">
                      {o.items.map((i) => (
                        <li key={i.id}>
                          {i.quantity}× {i.name} <StatusChip status={i.status} />
                        </li>
                      ))}
                    </ul>
                    <div className="progress-list">
                      {o.progress.map((p) => (
                        <div key={p.stationId} className="progress-row small">
                          <span>{p.stationName}</span>
                          <span className="bar">
                            <span style={{ width: `${(p.done / p.total) * 100}%` }} />
                          </span>
                          <span className="muted">
                            {p.done}/{p.total}
                          </span>
                        </div>
                      ))}
                    </div>
                    {o.status === "STAGED" && (
                      <div className="staged">
                        📦 {o.packageCount} pkg at <b>{o.stagingLocation}</b>
                      </div>
                    )}
                    {!o._cancelled && (o.status === "READY" || o.status === "STAGED") && (
                      <div className="row-actions">
                        <button className="btn btn-lg" onClick={() => setStaging(o)}>
                          {o.status === "STAGED" ? "Move" : "Stage"}
                        </button>
                        <button className="btn btn-lg btn-complete" onClick={() => post(o, "handoff", {}, `#${o.number} handed off`)}>
                          {o.fulfillmentType === "DELIVERY" ? "Hand to driver" : "Picked up"}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
      {staging && <StageModal order={staging} onClose={() => setStaging(null)} onSubmit={(loc, n) => { const o = staging; setStaging(null); void post(o, "stage", { location: loc, packageCount: n }, `#${o.number} staged at ${loc}`); }} />}
      {toast.node}
    </main>
  );
}

function StageModal({ order, onClose, onSubmit }: { order: ExpoOrder; onClose: () => void; onSubmit: (loc: string, n: number) => void }) {
  const [loc, setLoc] = useState(order.stagingLocation ?? "");
  const [n, setN] = useState(order.packageCount ?? order.items.reduce((s, i) => s + i.quantity, 0));
  return (
    <Modal title={`Stage #${order.number}`} onClose={onClose}>
      <p className="muted">Where is it, and how many packages?</p>
      <div className="reason-grid">
        {SHELVES.map((s) => (
          <button key={s} className={`btn btn-lg ${loc === s ? "btn-selected" : ""}`} onClick={() => setLoc(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="stepper">
        <span>Packages</span>
        <button className="btn btn-lg" onClick={() => setN(Math.max(1, n - 1))}>
          −
        </button>
        <b>{n}</b>
        <button className="btn btn-lg" onClick={() => setN(Math.min(50, n + 1))}>
          +
        </button>
      </div>
      <div className="row-actions">
        <button className="btn btn-lg" onClick={onClose}>
          Back
        </button>
        <button className="btn btn-lg btn-complete" disabled={!loc} onClick={() => onSubmit(loc, n)}>
          Stage {label(order.fulfillmentType).toLowerCase()} order
        </button>
      </div>
    </Modal>
  );
}
