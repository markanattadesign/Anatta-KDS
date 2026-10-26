/**
 * End-to-end smoke test against a running server, over HTTP only:
 * webhook intake -> station work -> QC fail -> rework -> QC pass -> stage ->
 * handoff, while a live SSE subscriber counts events. Also checks role gates.
 *
 *   KDS_URL=http://localhost:8080 npm run smoke
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomUUID } from "node:crypto";
import { config } from "dotenv";
import { DEMO_PASSWORD } from "@kds/contracts";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../.env") });
const base = process.env.KDS_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};

async function login(email: string) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  const cookie = r.headers.get("set-cookie")?.split(";")[0] ?? "";
  const json = (await r.json()) as { memberships: { storeId: string }[] };
  return { cookie, storeId: json.memberships[0]!.storeId };
}

function client(cookie: string) {
  return async <T = any>(p: string, body?: unknown): Promise<{ status: number; json: T }> => {
    const r = await fetch(`${base}${p}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as T };
  };
}

const assoc = await login("associate1@ediblekds.demo");
const qcUser = await login("qc@ediblekds.demo");
const storeId = assoc.storeId;
const A = client(assoc.cookie);
const Q = client(qcUser.cookie);
const S = `/api/stores/${storeId}`;

// Role gates
check((await A(`${S}/qc`)).status === 403, "associate is denied the QC queue");
check((await client("")(`${S}/qc`)).status === 401, "anonymous request is 401");

// Live SSE subscriber
const events: string[] = [];
const ac = new AbortController();
const sse = fetch(`${base}${S}/events`, { headers: { cookie: assoc.cookie }, signal: ac.signal }).then(async (r) => {
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const end = buf.lastIndexOf("\n\n");
    if (end < 0) continue;
    for (const m of buf.slice(0, end + 2).matchAll(/event: kds\ndata: (.*)\n/g)) events.push(JSON.parse(m[1]!).type);
    buf = buf.slice(end + 2);
  }
}).catch(() => {});
await new Promise((r) => setTimeout(r, 500));

// Intake via signed webhook
const body = JSON.stringify({
  eventId: `smoke_${randomUUID()}`,
  order: {
    externalId: `SMOKE-${Date.now()}`,
    customerName: "Smoke Test",
    fulfillmentType: "PICKUP",
    promisedAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    items: [{ sku: "DB-12", quantity: 1 }],
  },
});
const ts = String(Date.now());
const sig = createHmac("sha256", process.env.DEMO_ADAPTER_SECRET!).update(`${ts}.${body}`).digest("hex");
const wh = await fetch(`${base}/api/integrations/demo/orders`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-KDS-Timestamp": ts, "X-KDS-Signature": `sha256=${sig}` },
  body,
});
const { orderId, number } = (await wh.json()) as { orderId: string; number: number };
check(wh.status === 201, `webhook created order #${number}`);

// Work every task of this order, station by station, as the DAG unlocks them.
async function workOrder() {
  for (let guard = 0; guard < 20; guard++) {
    let did = false;
    const stations = (await A<{ products: unknown }>(`/api/menu`)).status === 200 ? await stationIds() : [];
    for (const st of stations) {
      const q = await A<{ tasks: { task: { id: string; status: string; version: number; name: string }; order: { id: string } }[] }>(
        `${S}/stations/${st}/queue`,
      );
      for (const t of q.json.tasks.filter((x) => x.order.id === orderId && x.task.status === "READY")) {
        const s1 = await A(`${S}/tasks/${t.task.id}/start`, { expectedVersion: t.task.version });
        const s2 = await A(`${S}/tasks/${t.task.id}/complete`, {});
        check(s1.status === 200 && s2.status === 200, `  ${t.task.name}`);
        did = true;
      }
    }
    if (!did) return;
  }
}
let cachedStations: string[] | null = null;
async function stationIds() {
  if (cachedStations) return cachedStations;
  const html = await (await fetch(`${base}/stores/${storeId}`, { headers: { cookie: assoc.cookie } })).text();
  cachedStations = [...new Set([...html.matchAll(/\/stations\/([a-z0-9]+)/g)].map((m) => m[1]!))];
  return cachedStations;
}

await workOrder();
let qq = await Q<{ items: { item: { id: string }; order: { id: string } }[] }>(`${S}/qc`);
const qcItem = qq.json.items.find((i) => i.order.id === orderId);
check(!!qcItem, "item reached the QC queue");

const fail = await Q(`${S}/qc/${qcItem!.item.id}`, { result: "FAIL", defectCodes: ["CHOCOLATE_SMUDGE"], notes: "smudge on lid" });
check(fail.status === 200, "QC fail recorded");
await workOrder(); // rework task at Assembly
qq = await Q(`${S}/qc`);
check(qq.json.items.some((i) => i.order.id === orderId), "item back in QC after rework");
const pass = await Q(`${S}/qc/${qcItem!.item.id}`, {
  result: "PASS",
  checklist: { matches_ticket: true, fruit_quality: true, chocolate_finish: true, secure: true },
});
check(pass.status === 200, "QC pass recorded");

const stage = await Q(`${S}/orders/${orderId}/stage`, { location: "A1", packageCount: 1 });
check(stage.status === 200 && (stage.json as any).order.status === "STAGED", "order staged at A1");
const handoff = await Q(`${S}/orders/${orderId}/handoff`, {});
check(handoff.status === 200 && (handoff.json as any).order.status === "COMPLETED", "order handed off");
const again = await Q(`${S}/orders/${orderId}/handoff`, {});
check(again.status === 409, "second handoff rejected (409)");

await new Promise((r) => setTimeout(r, 1200));
ac.abort();
await sse;
check(events.includes("ORDER_CREATED") && events.includes("QC_RESULT") && events.includes("TASK_UPDATED"), `SSE delivered ${events.length} live events (${[...new Set(events)].join(", ")})`);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
