import { CancelInputSchema } from "@kds/contracts";
import { DomainError, cancelOrder, handoffOrder, stageOrder } from "@kds/domain";
import { handle, parseBody, requireStoreUser } from "@/lib/api";

export const POST = handle<{ storeId: string; orderId: string; action: string }>(async (req, { storeId, orderId, action }) => {
  switch (action) {
    case "stage": {
      const user = await requireStoreUser(storeId, "QC");
      return { order: await stageOrder(storeId, orderId, await req.json().catch(() => ({})), user.id) };
    }
    case "handoff": {
      const user = await requireStoreUser(storeId, "QC");
      return { order: await handoffOrder(storeId, orderId, user.id) };
    }
    case "cancel": {
      const user = await requireStoreUser(storeId, "MANAGER");
      const { reason } = await parseBody(req, CancelInputSchema);
      return { order: await cancelOrder(storeId, orderId, user.id, reason) };
    }
    default:
      throw new DomainError("NOT_FOUND", `Unknown action ${action}`);
  }
});
