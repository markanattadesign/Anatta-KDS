"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui";
import { ApiError, api } from "@/lib/client";
import { label } from "@/lib/format";

interface Product {
  sku: string;
  name: string;
  allergens: string[];
}

export function NewOrderButton({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        + New order
      </button>
      {open && <NewOrderModal storeId={storeId} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewOrderModal({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [customerName, setCustomer] = useState("");
  const [fulfillmentType, setType] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [minutes, setMinutes] = useState(60);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ products: Product[] }>("/api/menu").then((r) => setProducts(r.products));
  }, []);

  const items = Object.entries(qty)
    .filter(([, n]) => n > 0)
    .map(([sku, quantity]) => ({ sku, quantity }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { order } = await api<{ order: { id: string } }>(`/api/stores/${storeId}/orders`, {
        body: {
          customerName,
          fulfillmentType,
          promisedAt: new Date(Date.now() + minutes * 60_000).toISOString(),
          notes,
          items,
        },
      });
      onClose();
      router.push(`/stores/${storeId}/orders/${order.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create order");
      setBusy(false);
    }
  }

  return (
    <Modal title="New order" onClose={onClose}>
      <div className="stack">
        <label className="field">
          <span>Customer name</span>
          <input value={customerName} onChange={(e) => setCustomer(e.target.value)} maxLength={80} autoFocus />
        </label>
        <div className="seg">
          {(["PICKUP", "DELIVERY"] as const).map((t) => (
            <button key={t} className={`btn ${fulfillmentType === t ? "btn-selected" : ""}`} onClick={() => setType(t)}>
              {label(t)}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Promised in (minutes)</span>
          <input type="number" min={5} max={1440} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
        <div>
          <span className="field-label">Items</span>
          {products.map((p) => (
            <div key={p.sku} className="product-row">
              <span>
                {p.name} <span className="muted small">{p.sku}</span>
                {p.allergens.length > 0 && <span className="muted small"> · {p.allergens.map(label).join(", ")}</span>}
              </span>
              <span className="stepper">
                <button className="btn btn-sm" onClick={() => setQty({ ...qty, [p.sku]: Math.max(0, (qty[p.sku] ?? 0) - 1) })}>
                  −
                </button>
                <b>{qty[p.sku] ?? 0}</b>
                <button className="btn btn-sm" onClick={() => setQty({ ...qty, [p.sku]: Math.min(20, (qty[p.sku] ?? 0) + 1) })}>
                  +
                </button>
              </span>
            </div>
          ))}
        </div>
        <label className="field">
          <span>Order notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="e.g. Happy birthday card, no pineapple" />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary btn-lg" disabled={busy || !customerName.trim() || !items.length} onClick={submit}>
          {busy ? "Creating…" : "Create order"}
        </button>
      </div>
    </Modal>
  );
}
