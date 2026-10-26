import type { KdsEvent } from "@kds/contracts";
import { DomainError, latestOutboxSeq, readOutbox, requireStoreRole } from "@kds/domain";
import { getBus } from "@/lib/bus";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events for one store. On (re)connect the client's Last-Event-ID
 * is used to replay missed outbox events before live ones; a `hello` event
 * tells the client it is in sync so it can refetch its screen.
 */
export async function GET(req: Request, ctx: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await ctx.params;
  try {
    const session = await getSession();
    await requireStoreRole(session.userId, storeId, "ASSOCIATE");
  } catch (e) {
    const status = e instanceof DomainError ? e.status : 500;
    return new Response("Unauthorized", { status });
  }

  const header = req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("since");
  const lastId = header !== null && header !== "" ? Number(header) : NaN;
  const bus = await getBus();
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          closed = true;
        }
      };
      let sent = Number.isFinite(lastId) ? lastId : await latestOutboxSeq();
      let replaying = true;
      const buffered: KdsEvent[] = [];
      const send = (e: KdsEvent) => {
        if (e.storeId !== storeId || e.seq <= sent) return;
        sent = e.seq;
        write(`id: ${e.seq}\nevent: kds\ndata: ${JSON.stringify(e)}\n\n`);
      };
      const onEvent = (e: KdsEvent) => (replaying ? buffered.push(e) : send(e));
      bus.on("event", onEvent);
      const ping = setInterval(() => write(": ping\n\n"), 15_000);
      cleanup = () => {
        closed = true;
        bus.off("event", onEvent);
        clearInterval(ping);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });

      write("retry: 2000\n\n");
      let replayed = 0;
      if (Number.isFinite(lastId)) {
        const missed = await readOutbox(lastId, 1000, storeId);
        replayed = missed.length;
        missed.forEach(send);
      }
      replaying = false;
      buffered.sort((a, b) => a.seq - b.seq).forEach(send);
      write(`event: hello\ndata: ${JSON.stringify({ seq: sent, replayed })}\n\n`);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
