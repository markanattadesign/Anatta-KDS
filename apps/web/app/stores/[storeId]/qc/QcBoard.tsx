"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFECT_CODES, QC_CHECKLIST, type DefectCode } from "@kds/contracts";
import { AllergenBanner, ConnectionBanner, LiveDot, Modal, useToast } from "@/components/ui";
import { ApiError, api } from "@/lib/client";
import { fmtMinutes, fmtTime, label, urgency } from "@/lib/format";
import type { QcQueue } from "@/lib/types";
import { useDebounced, useNow, useStoreEvents } from "@/lib/useStoreEvents";

type Entry = QcQueue["items"][number];

export function QcBoard({ storeId, timeZone }: { storeId: string; timeZone: string }) {
  const [data, setData] = useState<QcQueue | null>(null);
  const [failing, setFailing] = useState<Entry | null>(null);
  const toast = useToast();
  const now = useNow(5000);

  const load = useCallback(async () => {
    try {
      setData(await api<QcQueue>(`/api/stores/${storeId}/qc`));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't load QC queue");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);
  const reload = useDebounced(load);
  const { connected } = useStoreEvents(storeId, { onSync: reload, onEvent: reload });
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(entry: Entry, body: { result: "PASS" | "FAIL"; checklist: Record<string, boolean>; defectCodes?: DefectCode[]; notes?: string }) {
    try {
      await api(`/api/stores/${storeId}/qc/${entry.item.id}`, { body });
      toast.ok(body.result === "PASS" ? `#${entry.order.number} ${entry.item.name} passed` : `Sent to rework`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save inspection");
      await load();
    }
  }

  return (
    <main className="board">
      <ConnectionBanner connected={connected} />
      <div className="board-head">
        <h1>QC inspection</h1>
        <div className="head-stats">
          <span>
            <b>{data?.items.length ?? 0}</b> awaiting
          </span>
          <LiveDot connected={connected} />
        </div>
      </div>
      <section className="tickets">
        {data && !data.items.length && (
          <div className="empty">
            <span className="empty-icon">✅</span>Nothing to inspect right now.
          </div>
        )}
        {data?.items.map((e) => (
          <QcCard key={e.item.id} e={e} now={now} timeZone={timeZone} onPass={(c) => submit(e, { result: "PASS", checklist: c })} onFail={() => setFailing(e)} />
        ))}
      </section>
      {failing && (
        <FailModal
          entry={failing}
          onClose={() => setFailing(null)}
          onSubmit={(codes, notes) => {
            const e = failing;
            setFailing(null);
            void submit(e, { result: "FAIL", checklist: {}, defectCodes: codes, notes });
          }}
        />
      )}
      {toast.node}
    </main>
  );
}

function QcCard({
  e,
  now,
  timeZone,
  onPass,
  onFail,
}: {
  e: Entry;
  now: number;
  timeZone: string;
  onPass: (checklist: Record<string, boolean>) => void;
  onFail: () => void;
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const all = QC_CHECKLIST.every((c) => checks[c.key]);
  const left = new Date(e.order.promisedAt).getTime() - now;
  return (
    <article className={`ticket u-${urgency(e.order.promisedAt, now)}`}>
      <header className="ticket-head">
        <span className="ticket-num">#{e.order.number}</span>
        <span className={`tag tag-${e.order.fulfillmentType.toLowerCase()}`}>{label(e.order.fulfillmentType)}</span>
        <span className="ticket-due">
          <b>{left < 0 ? `${fmtMinutes(-left)} late` : `due in ${fmtMinutes(left)}`}</b>
          <span className="muted small"> · {fmtTime(e.order.promisedAt, timeZone)}</span>
        </span>
      </header>
      <div className="qc-item">
        <b>
          {e.item.quantity}× {e.item.name}
        </b>
        <div className="muted small">Should contain: {e.item.recipeSnapshot.components.join(", ") || "—"}</div>
        {e.item.notes && <div className="note">📝 {e.item.notes}</div>}
      </div>
      <AllergenBanner allergens={e.order.allergens} />
      {e.previousFails.length > 0 && (
        <div className="banner banner-warn small">
          Re-inspection (failed {e.previousFails.length}×: {e.previousFails.flatMap((f) => f.defectCodes).map(label).join(", ")})
        </div>
      )}
      <ul className="checklist">
        {QC_CHECKLIST.map((c) => (
          <li key={c.key}>
            <label>
              <input type="checkbox" checked={!!checks[c.key]} onChange={(ev) => setChecks({ ...checks, [c.key]: ev.target.checked })} />
              {c.label}
            </label>
          </li>
        ))}
      </ul>
      <div className="row-actions">
        <button className="btn btn-lg btn-danger" onClick={onFail}>
          Fail
        </button>
        <button className="btn btn-lg btn-complete" disabled={!all} onClick={() => onPass(checks)} title={all ? "" : "Tick every check to pass"}>
          Pass
        </button>
      </div>
    </article>
  );
}

function FailModal({ entry, onClose, onSubmit }: { entry: Entry; onClose: () => void; onSubmit: (codes: DefectCode[], notes: string) => void }) {
  const [codes, setCodes] = useState<DefectCode[]>([]);
  const [notes, setNotes] = useState("");
  const toggle = (c: DefectCode) => setCodes((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  return (
    <Modal title={`Fail #${entry.order.number} · ${entry.item.name}`} onClose={onClose}>
      <p className="muted">Pick what's wrong. A rework task goes to Assembly.</p>
      <div className="reason-grid">
        {DEFECT_CODES.map((c) => (
          <button key={c} className={`btn btn-lg ${codes.includes(c) ? "btn-selected" : ""}`} onClick={() => toggle(c)}>
            {label(c)}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Notes (optional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="e.g. two strawberries bruised on the left" />
      </label>
      <div className="row-actions">
        <button className="btn btn-lg" onClick={onClose}>
          Back
        </button>
        <button className="btn btn-lg btn-danger" disabled={!codes.length} onClick={() => onSubmit(codes, notes)}>
          Send to rework
        </button>
      </div>
    </Modal>
  );
}
