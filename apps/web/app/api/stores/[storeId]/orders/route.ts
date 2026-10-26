import { ORDER_STATUSES, type OrderStatus } from "@kds/contracts";
import { createOrder, listOrders } from "@kds/domain";
import { handle, requireStoreUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handle<{ storeId: string }>(async (req, { storeId }) => {
  await requireStoreUser(storeId, "MANAGER");
  const status = new URL(req.url).searchParams.get("status");
  return {
    orders: await listOrders(storeId, {
      status: ORDER_STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined,
    }),
  };
});

/** Manual order entry (phone / walk-in). */
export const POST = handle<{ storeId: string }>(async (req, { storeId }) => {
  const user = await requireStoreUser(storeId, "MANAGER");
  const body = await req.json().catch(() => ({}));
  const { order } = await createOrder(storeId, { ...body, source: "MANUAL", externalId: undefined }, user.id);
  return { order };
});
