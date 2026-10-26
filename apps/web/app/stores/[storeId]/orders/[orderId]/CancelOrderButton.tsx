"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/ui";
import { ApiError, api } from "@/lib/client";

const REASONS = ["Customer cancelled", "Duplicate order", "Out of stock", "Payment issue", "Other"];

export function CancelOrderButton({ storeId, orderId, number }: { storeId: string; orderId: string; number: number }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  async function cancel(reason: string) {
    try {
      await api(`/api/stores/${storeId}/orders/${orderId}/cancel`, { body: { reason } });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't cancel");
    }
  }
  return (
    <>
      <button className="btn btn-danger" onClick={() => setOpen(true)}>
        Cancel order
      </button>
      {open && (
        <Modal title={`Cancel order #${number}?`} onClose={() => setOpen(false)}>
          <p className="muted">All open tasks are cancelled and stations are alerted.</p>
          <div className="reason-grid">
            {REASONS.map((r) => (
              <button key={r} className="btn btn-lg" onClick={() => cancel(r)}>
                {r}
              </button>
            ))}
          </div>
          {error && <div className="form-error">{error}</div>}
        </Modal>
      )}
    </>
  );
}
