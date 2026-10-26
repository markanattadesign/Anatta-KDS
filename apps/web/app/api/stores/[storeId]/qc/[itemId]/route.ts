import { inspectItem } from "@kds/domain";
import { handle, requireStoreUser } from "@/lib/api";

export const POST = handle<{ storeId: string; itemId: string }>(async (req, { storeId, itemId }) => {
  const user = await requireStoreUser(storeId, "QC");
  const body = await req.json().catch(() => ({}));
  const inspection = await inspectItem(storeId, itemId, body, user.id);
  return { inspection };
});
