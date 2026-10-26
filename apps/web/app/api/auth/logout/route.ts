import { handle } from "@/lib/api";
import { getSession } from "@/lib/session";

export const POST = handle(async () => {
  const session = await getSession();
  session.destroy();
  return { ok: true };
});
