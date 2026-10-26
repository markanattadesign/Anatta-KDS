import { LoginInputSchema } from "@kds/contracts";
import { DomainError, getMemberships, verifyLogin } from "@kds/domain";
import { handle, parseBody } from "@/lib/api";
import { getSession } from "@/lib/session";

export const POST = handle(async (req) => {
  const { email, password } = await parseBody(req, LoginInputSchema);
  const user = await verifyLogin(email, password);
  if (!user) throw new DomainError("UNAUTHORIZED", "Email or password is incorrect");
  const session = await getSession();
  session.userId = user.id;
  session.name = user.name;
  session.email = user.email;
  await session.save();
  const memberships = await getMemberships(user.id);
  return { user, memberships };
});
