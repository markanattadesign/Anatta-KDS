/**
 * Order simulator: posts signed webhooks to the demo adapter so screens fill
 * up with realistic traffic.
 *
 *   npm run simulate                       # 6 orders, 4s apart
 *   npm run simulate -- --count 20 --interval 2
 *   npm run simulate -- --duplicates       # re-sends each event to show idempotency
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, randomUUID } from "node:crypto";
import { config } from "dotenv";
import { DEMO_PRODUCTS } from "@kds/contracts";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../.env") });

const args = process.argv.slice(2);
const opt = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const count = opt("count", 6);
const intervalSec = opt("interval", 4);
const duplicates = args.includes("--duplicates");
const base = process.env.KDS_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const secret = process.env.DEMO_ADAPTER_SECRET;
if (!secret) throw new Error("DEMO_ADAPTER_SECRET is not set (copy env.example to .env)");

const NAMES = ["Riley", "Casey", "Taylor", "Jamie", "Drew", "Parker", "Avery", "Rowan", "Skyler", "Emerson", "Hayden", "Quinn"];
const NOTES = ["", "", "", "Happy birthday card", "Extra ribbon please", "Leave with front desk", "No pineapple on top"];
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]!;

async function send(body: string) {
  const ts = String(Date.now());
  const sig = createHmac("sha256", secret!).update(`${ts}.${body}`).digest("hex");
  const res = await fetch(`${base}/api/integrations/demo/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-KDS-Timestamp": ts, "X-KDS-Signature": `sha256=${sig}` },
    body,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

for (let n = 0; n < count; n++) {
  const items = Array.from({ length: Math.random() < 0.3 ? 2 : 1 }, () => ({
    sku: pick(DEMO_PRODUCTS).sku,
    quantity: Math.random() < 0.8 ? 1 : 2,
  }));
  const body = JSON.stringify({
    eventId: `evt_${randomUUID()}`,
    order: {
      externalId: `DEMO-${Date.now().toString(36).toUpperCase()}-${n}`,
      customerName: pick(NAMES),
      fulfillmentType: Math.random() < 0.55 ? "PICKUP" : "DELIVERY",
      promisedAt: new Date(Date.now() + (10 + Math.floor(Math.random() * 80)) * 60_000).toISOString(),
      notes: pick(NOTES),
      items,
    },
  });
  try {
    const r = await send(body);
    console.log(`${r.status} order #${r.json.number ?? "?"} ${items.map((i) => `${i.quantity}x${i.sku}`).join(" ")}${r.json.error ? ` — ${r.json.error}` : ""}`);
    if (duplicates) {
      const d = await send(body);
      console.log(`  ↳ resend: ${d.status} duplicate=${d.json.duplicate}`);
    }
  } catch (e) {
    console.error(`failed to reach ${base}: ${(e as Error).message}`);
    process.exit(1);
  }
  if (n < count - 1) await new Promise((r) => setTimeout(r, intervalSec * 1000));
}
