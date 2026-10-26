import { EventEmitter } from "node:events";
import type { KdsEvent } from "@kds/contracts";
import { latestOutboxSeq, readOutbox } from "@kds/domain";

/**
 * In-process pub/sub fed by polling the outbox table. The outbox is the source
 * of truth, so a client that misses a live event replays it by sequence number
 * on reconnect. Single-instance only; multiple servers would need a shared bus
 * (e.g. Postgres LISTEN/NOTIFY).
 */
const g = globalThis as unknown as { __kdsBus?: Promise<EventEmitter> };

/**
 * Resolves once the poller knows its starting sequence number. SSE handlers
 * await this before reading their own starting point, so the bus's cursor is
 * always <= theirs and no event can fall between the two.
 */
export function getBus(): Promise<EventEmitter> {
  g.__kdsBus ??= (async () => {
    const bus = new EventEmitter();
    bus.setMaxListeners(0);
    const start = await latestOutboxSeq();
    void poll(bus, start);
    return bus;
  })().catch((e) => {
    g.__kdsBus = undefined;
    throw e;
  });
  return g.__kdsBus;
}

async function poll(bus: EventEmitter, start: number) {
  let last = start;
  for (;;) {
    let got = 0;
    try {
      const events = await readOutbox(last, 500);
      got = events.length;
      for (const e of events) {
        last = e.seq;
        bus.emit("event", e satisfies KdsEvent);
      }
    } catch (e) {
      console.error("[bus] outbox poll failed", e);
    }
    await new Promise((r) => setTimeout(r, got === 500 ? 0 : 300));
  }
}
