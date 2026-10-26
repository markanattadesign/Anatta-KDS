import { ingestDemoWebhook } from "@kds/domain";
import { handle } from "@/lib/api";

/**
 * Demo delivery-platform webhook. Authenticated by HMAC signature, not session:
 *   X-KDS-Timestamp: <ms since epoch>
 *   X-KDS-Signature: sha256=<hex hmac of "<timestamp>.<raw body>">
 */
export const POST = handle(async (req) => {
  const raw = await req.text();
  const result = await ingestDemoWebhook(raw, {
    timestamp: req.headers.get("x-kds-timestamp"),
    signature: req.headers.get("x-kds-signature"),
  });
  return Response.json(result, { status: result.duplicate ? 200 : 201 });
});
