"use client";

import { useEffect, useState, type ReactNode } from "react";
import { label } from "@/lib/format";

export function ConnectionBanner({ connected }: { connected: boolean }) {
  if (connected) return null;
  return (
    <div className="banner banner-warn" role="status">
      Connection lost. Showing the last known state; reconnecting automatically…
    </div>
  );
}

export function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span className={`live ${connected ? "on" : "off"}`} title={connected ? "Live" : "Reconnecting"}>
      <span className="dot" /> {connected ? "Live" : "Offline"}
    </span>
  );
}

export function AllergenBanner({ allergens }: { allergens: string[] }) {
  if (!allergens.length) return null;
  return (
    <div className="allergen" role="alert">
      ⚠ Allergens: {allergens.map(label).join(" · ")}
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip chip-${status.toLowerCase()}`}>{label(status)}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Tiny toast queue. */
export function useToast() {
  const [msg, setMsg] = useState<{ text: string; kind: "error" | "ok" } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? <div className={`toast toast-${msg.kind}`}>{msg.text}</div> : null;
  return {
    node,
    error: (text: string) => setMsg({ text, kind: "error" }),
    ok: (text: string) => setMsg({ text, kind: "ok" }),
  };
}
