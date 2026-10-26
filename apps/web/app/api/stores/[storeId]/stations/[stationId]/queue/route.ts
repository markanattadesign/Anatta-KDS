import { getStationQueue } from "@kds/domain";
import { handle, requireStoreUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handle<{ storeId: string; stationId: string }>(async (_req, { storeId, stationId }) => {
  await requireStoreUser(storeId, "ASSOCIATE");
  return getStationQueue(storeId, stationId);
});
