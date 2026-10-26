import { redirect } from "next/navigation";
import { ROLE_RANK, type Role } from "@kds/contracts";
import { getMemberships, getStore } from "@kds/domain";
import { getSession } from "./session";

/**
 * Page-level auth: redirects to /login when signed out. Returns the user's
 * role in the store, or `allowed: false` when the role is too low.
 */
export async function pageAuth(storeId: string, minRole: Role) {
  const s = await getSession();
  if (!s.userId) redirect("/login");
  const memberships = await getMemberships(s.userId);
  const m = memberships.find((x) => x.storeId === storeId);
  const store = await getStore(storeId);
  const user = { id: s.userId, name: s.name ?? "", email: s.email ?? "" };
  if (!m || !store) return { allowed: false as const, user, store, role: null, memberships };
  return {
    allowed: ROLE_RANK[m.role] >= ROLE_RANK[minRole],
    user,
    store,
    role: m.role,
    memberships,
  };
}

export const atLeast = (role: Role | null, min: Role) => !!role && ROLE_RANK[role] >= ROLE_RANK[min];
