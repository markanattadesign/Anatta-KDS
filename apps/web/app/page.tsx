import { redirect } from "next/navigation";
import { getMemberships } from "@kds/domain";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const s = await getSession();
  if (!s.userId) redirect("/login");
  const [first] = await getMemberships(s.userId);
  if (!first) redirect("/login?error=no-store");
  redirect(`/stores/${first.storeId}`);
}
