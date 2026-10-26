import { getOverview } from "@kds/domain";
import { handle, requireStoreUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handle<{ storeId: string }>(async (_req, { storeId }) => {
  await requireStoreUser(storeId, "MANAGER");
  return getOverview(storeId);
});
