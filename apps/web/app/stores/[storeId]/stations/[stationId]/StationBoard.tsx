"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ROLE_RANK, allowedTaskActions, type Role, type TaskAction } from "@kds/contracts";
import { AllergenBanner, ConnectionBanner, LiveDot, Modal, StatusChip, useToast } from "@/components/ui";
import { ApiError, api } from "@/lib/client";
import { fmtDuration, fmtMinutes, fmtTime, label, urgency } from "@/lib/format";
import type { StationQueue, StationTask } from "@/lib/types";
import { useDebounced, useNow, useStoreEvents } from "@/lib/useStoreEvents";

const ACTION_LABEL: Record<TaskAction, string> = {
  claim: "Claim",
  unclaim: "Release",
  start: "Start",
  complete: "Done",
  hold: "Hold",
  resume: "Resume",
};
const HOLD_REASONS = ["Out of ingredient", "Equipment issue", "Need manager", "Customer change", "Break"];
const CANCEL_FLASH_MS = 20_000;

interface Ticket {
  orderId: string;
  order: StationTask["order"];
  active: StationTask[];
  blocked: StationTask[];
}

function group(tasks: StationTask[]): Ticket[] {
  const map = new Map<string, Ticket>();
  for (const t of tasks) {
    let g = map.get(t.order.id);
    if (!g) map.set(t.order.id, (g = { orderId: t.order.id, order: t.order, active: [], blocked: [] }));
    (t.task.status === "BLOCKED" ? g.blocked : g.active).push(t);
  }
  return [...map.values()];
}

export function StationBoard(props: { storeId: string; stationId: string; userId: string; role: Role; timeZone: string }) {
  const { storeId, stationId, userId, role, timeZone } = props;
  const [data, setData] = useState<StationQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<StationTask | null>(null);
  const [holdFor, setHoldFor] = useState<StationTask | null>(null);
  const [cancelled, setCancelled] = useState<Map<string, { ticket: Ticket; until: number }>>(new Map());
  const [mineOnly, setMineOnly] = useState(false);
  const toast = useToast();
  const now = useNow(5000);
  const ticketsRef = useRef<Ticket[]>([]);

  const load = useCallback(async () => {
    try {
      const q = await api<StationQueue>(`/api/stores/${storeId}/stations/${stationId}/queue`);
      setData(q);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the queue");
    }
  }, [storeId, stationId]);
  const reload = useDebounced(load);

  const { connected } = useStoreEvents(storeId, {
    onSync: reload,
    onEvent: (e) => {
      const stationIds = (e.payload.stationIds as string[] | undefined) ?? [];
      if (e.type === "ORDER_CANCELLED") {
        const t = ticketsRef.current.find((x) => x.orderId === e.payload.orderId);
        if (t) setCancelled((m) => new Map(m).set(t.orderId, { ticket: t, until: Date.now() + CANCEL_FLASH_MS }));
      }
      if (stationIds.includes(stationId) || e.type === "ORDER_CANCELLED" || e.type === "ORDER_UPDATED") reload();
    },
  });

  useEffect(() => {
    void load();
  }, [load]);

  // Drop cancelled-flash cards once they expire.
  useEffect(() => {
    if (!cancelled.size) return;
    const live = [...cancelled].filter(([, v]) => v.until > now);
    if (live.length !== cancelled.size) setCancelled(new Map(live));
  }, [now, cancelled]);

  const tickets = useMemo(() => {
    let tasks = data?.tasks ?? [];
    if (mineOnly) tasks = tasks.filter((t) => !t.task.claimedBy || t.task.claimedBy === userId);
    return group(tasks);
  }, [data, mineOnly, userId]);
  ticketsRef.current = tickets;

  const activeTickets = tickets.filter((t) => t.active.length);
  const upcoming = tickets.filter((t) => !t.active.length && t.blocked.length);
  const flashes = [...cancelled.values()].map((v) => v.ticket).filter((t) => !tickets.some((x) => x.orderId === t.orderId));

  // All-day: open (non-blocked) work at this station, summed by step across orders.
  const allDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data?.tasks ?? []) {
      if (t.task.status === "BLOCKED") continue;
      m.set(t.task.name, (m.get(t.task.name) ?? 0) + t.item.quantity);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  async function act(t: StationTask, action: TaskAction, reason?: string) {
    setBusy(t.task.id);
    try {
      await api(`/api/stores/${storeId}/tasks/${t.task.id}/${action}`, {
        body: { expectedVersion: t.task.version, reason },
      });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "That didn't work. Try again.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  const canOverride = ROLE_RANK[role] >= ROLE_RANK.MANAGER;
  const actionsFor = (t: StationTask): TaskAction[] => {
    const all = allowedTaskActions(t.task.status);
    const othersClaim = t.task.claimedBy && t.task.claimedBy !== userId && !canOverride;
    return othersClaim ? [] : all;
  };

  return (
    <main className="board">
      <ConnectionBanner connected={connected} />
      <div className="board-head">
        <h1>{data?.station.name ?? "Station"}</h1>
        <div className="head-stats">
          <span>
            <b>{data?.tasks.filter((t) => t.task.status !== "BLOCKED").length ?? 0}</b> to do
          </span>
          <span className="muted">{data?.tasks.filter((t) => t.task.status === "BLOCKED").length ?? 0} upcoming</span>
          <label className="toggle">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Mine + unclaimed
          </label>
          <LiveDot connected={connected} />
        </div>
      </div>
      {error && <div className="banner banner-error">{error}</div>}

      <div className="board-body">
        <section className="tickets">
          {!data && !error && <p className="muted">Loading…</p>}
          {data && !activeTickets.length && !flashes.length && (
            <div className="empty">
              <span className="empty-icon">✨</span>
              All caught up. New work shows up here automatically.
            </div>
          )}
          {flashes.map((t) => (
            <TicketCard key={`x-${t.orderId}`} ticket={t} now={now} timeZone={timeZone} cancelled />
          ))}
          {activeTickets.map((t) => (
            <TicketCard key={t.orderId} ticket={t} now={now} timeZone={timeZone}>
              {t.active.map((task) => (
                <TaskRow
                  key={task.task.id}
                  t={task}
                  now={now}
                  me={userId}
                  busy={busy === task.task.id}
                  actions={actionsFor(task)}
                  onAct={(a) => (a === "hold" ? setHoldFor(task) : act(task, a))}
                  onOpen={() => setDetail(task)}
                />
              ))}
              {t.blocked.length > 0 && (
                <div className="later muted small">
                  Later here: {t.blocked.map((b) => b.task.name).join(", ")}
                </div>
              )}
            </TicketCard>
          ))}
        </section>

        <aside className="side">
          <h3>All day</h3>
          {allDay.length ? (
            <ul className="allday">
              {allDay.map(([name, n]) => (
                <li key={name}>
                  <span className="allday-n">{n}</span> {name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Nothing open.</p>
          )}
          <h3>Upcoming</h3>
          {upcoming.length ? (
            <ul className="upcoming">
              {upcoming.map((u) =>
                u.blocked.map((b) => (
                  <li key={b.task.id} onClick={() => setDetail(b)}>
                    <b>#{u.order.number}</b> {b.task.name}
                    <div className="muted small">
                      Waiting on {b.waitingOn.map((w) => `${w.name} (${w.stationName})`).join(", ") || "earlier steps"}
                    </div>
                  </li>
                )),
              )}
            </ul>
          ) : (
            <p className="muted small">No waiting work.</p>
          )}
        </aside>
      </div>

      {detail && (
        <Modal title={detail.task.name} onClose={() => setDetail(null)}>
          <TaskDetail t={detail} timeZone={timeZone} />
        </Modal>
      )}
      {holdFor && (
        <Modal title={`Hold: ${holdFor.task.name}`} onClose={() => setHoldFor(null)}>
          <p className="muted">Why is this on hold?</p>
          <div className="reason-grid">
            {HOLD_REASONS.map((r) => (
              <button
                key={r}
                className="btn btn-lg"
                onClick={() => {
                  const t = holdFor;
                  setHoldFor(null);
                  void act(t, "hold", r);
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {toast.node}
    </main>
  );
}

function TicketCard({
  ticket,
  now,
  timeZone,
  cancelled,
  children,
}: {
  ticket: Ticket;
  now: number;
  timeZone: string;
  cancelled?: boolean;
  children?: React.ReactNode;
}) {
  const o = ticket.order;
  const u = urgency(o.promisedAt, now);
  const left = new Date(o.promisedAt).getTime() - now;
  return (
    <article className={`ticket u-${u}${cancelled ? " cancelled" : ""}`}>
      {cancelled && <div className="cancel-banner">CANCELLED — stop work on this order</div>}
      <header className="ticket-head">
        <span className="ticket-num">#{o.number}</span>
        <span className={`tag tag-${o.fulfillmentType.toLowerCase()}`}>{label(o.fulfillmentType)}</span>
        <span className="ticket-due">
          <b>{left < 0 ? `${fmtMinutes(-left)} late` : `due in ${fmtMinutes(left)}`}</b>
          <span className="muted small"> · {fmtTime(o.promisedAt, timeZone)}</span>
        </span>
      </header>
      <div className="ticket-cust muted small">{o.customerName}</div>
      <AllergenBanner allergens={o.allergens} />
      {o.notes && <div className="note">📝 {o.notes}</div>}
      {!cancelled && children}
    </article>
  );
}

function TaskRow({
  t,
  now,
  me,
  busy,
  actions,
  onAct,
  onOpen,
}: {
  t: StationTask;
  now: number;
  me: string;
  busy: boolean;
  actions: TaskAction[];
  onAct: (a: TaskAction) => void;
  onOpen: () => void;
}) {
  const since = t.task.startedAt ?? t.task.readyAt;
  const elapsed = since ? Math.max(0, now - new Date(since).getTime()) : 0;
  const over = t.task.status === "IN_PROGRESS" && elapsed > t.task.durationSec * 1000;
  // Primary action first, big; secondary actions small.
  const primary = actions.find((a) => a === "complete" || a === "start" || a === "resume") ?? actions.find((a) => a === "claim");
  const secondary = actions.filter((a) => a !== primary && !(a === "claim" && primary === "start"));
  return (
    <div className={`task ${t.task.isRework ? "rework" : ""}`}>
      <button className="task-main" onClick={onOpen}>
        <div className="task-title">
          {t.task.isRework && <span className="chip chip-rework">Rework</span>}
          <span>{t.task.name}</span>
        </div>
        <div className="muted small">
          {t.item.quantity}× {t.item.name}
          {t.item.notes && <> · <i>{t.item.notes}</i></>}
        </div>
        <div className="task-meta small">
          <StatusChip status={t.task.status} />
          {t.claimedByName && <span className="muted">{t.task.claimedBy === me ? "You" : t.claimedByName}</span>}
          {t.task.status === "ON_HOLD" && t.task.holdReason && <span className="hold-reason">⏸ {t.task.holdReason}</span>}
          <span className={over ? "over" : "muted"}>
            {t.task.status === "IN_PROGRESS" ? "working" : "waiting"} {fmtMinutes(elapsed)} / target {fmtDuration(t.task.durationSec)}
          </span>
        </div>
      </button>
      <div className="task-actions">
        {secondary.map((a) => (
          <button key={a} className="btn btn-sm" disabled={busy} onClick={() => onAct(a)}>
            {ACTION_LABEL[a]}
          </button>
        ))}
        {primary && (
          <button className={`btn btn-xl btn-${primary}`} disabled={busy} onClick={() => onAct(primary)}>
            {busy ? "…" : ACTION_LABEL[primary]}
          </button>
        )}
        {!actions.length && <span className="muted small">Claimed by {t.claimedByName}</span>}
      </div>
    </div>
  );
}

function TaskDetail({ t, timeZone }: { t: StationTask; timeZone: string }) {
  return (
    <div className="stack">
      <div className="media-placeholder" aria-label="Step photo placeholder">
        <span>📷</span>
        <span className="muted small">Step photo placeholder</span>
      </div>
      <div>
        <b>
          Order #{t.order.number} · {t.item.quantity}× {t.item.name}
        </b>
        <div className="muted small">
          {t.order.customerName} · {label(t.order.fulfillmentType)} · due {fmtTime(t.order.promisedAt, timeZone)}
        </div>
      </div>
      <AllergenBanner allergens={t.order.allergens} />
      <div>
        <h4>Instructions</h4>
        <p>{t.task.instructions || <span className="muted">No extra instructions.</span>}</p>
        <p className="muted small">Target time: {fmtDuration(t.task.durationSec)}</p>
      </div>
      {t.task.dependsOn.length > 0 && (
        <div>
          <h4>Depends on</h4>
          {t.waitingOn.length ? (
            <ul>
              {t.waitingOn.map((w) => (
                <li key={w.name}>
                  {w.name} <span className="muted">· {w.stationName} ·</span> <StatusChip status={w.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">All earlier steps are done.</p>
          )}
        </div>
      )}
      {t.item.notes && <div className="note">📝 {t.item.notes}</div>}
    </div>
  );
}
