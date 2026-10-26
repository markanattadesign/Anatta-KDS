import { TASK_ACTIONS, TaskActionInputSchema, type TaskAction } from "@kds/contracts";
import { DomainError, transitionTask } from "@kds/domain";
import { handle, parseBody, requireStoreUser } from "@/lib/api";

export const POST = handle<{ storeId: string; taskId: string; action: string }>(async (req, { storeId, taskId, action }) => {
  if (!TASK_ACTIONS.includes(action as TaskAction)) throw new DomainError("NOT_FOUND", `Unknown action ${action}`);
  const user = await requireStoreUser(storeId, "ASSOCIATE");
  const body = await parseBody(req, TaskActionInputSchema);
  const task = await transitionTask(storeId, taskId, action as TaskAction, { id: user.id, role: user.role }, body);
  return { task };
});
