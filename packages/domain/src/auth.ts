import bcrypt from "bcryptjs";
import { and, asc, eq } from "drizzle-orm";
import { ROLE_RANK, type Role } from "@kds/contracts";
import { getDb, memberships, stations, stores, users } from "@kds/db";
import { DomainError, forbidden } from "./errors.ts";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

// Constant hash for unknown emails, so login timing doesn't reveal whether an account exists.
let dummyHash: string | undefined;

export async function verifyLogin(email: string, password: string): Promise<AuthUser | null> {
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  dummyHash ??= await bcrypt.hash("not-a-real-password", 10);
  const ok = await bcrypt.compare(password, u?.passwordHash ?? dummyHash);
  if (!u || !u.active || !ok) return null;
  return { id: u.id, email: u.email, name: u.name };
}

export async function getUser(userId: string): Promise<AuthUser | null> {
  const [u] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  return u && u.active ? { id: u.id, email: u.email, name: u.name } : null;
}

export async function getMemberships(userId: string) {
  return getDb()
    .select({ storeId: stores.id, storeName: stores.name, timezone: stores.timezone, role: memberships.role })
    .from(memberships)
    .innerJoin(stores, eq(stores.id, memberships.storeId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(stores.name));
}

/** Throws unless the user has at least `minRole` in the store. Returns the actual role. */
export async function requireStoreRole(userId: string | undefined, storeId: string, minRole: Role): Promise<Role> {
  if (!userId) throw new DomainError("UNAUTHORIZED", "Please sign in");
  const [m] = await getDb()
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.storeId, storeId)))
    .limit(1);
  if (!m) throw forbidden("You are not a member of this store");
  if (ROLE_RANK[m.role] < ROLE_RANK[minRole]) throw forbidden(`Requires ${minRole} role or higher`);
  return m.role;
}

/** True if the user has at least `minRole` in any store (used for store-agnostic admin pages). */
export async function hasRoleAnywhere(userId: string, minRole: Role): Promise<boolean> {
  const ms = await getMemberships(userId);
  return ms.some((m) => ROLE_RANK[m.role] >= ROLE_RANK[minRole]);
}

export async function getStore(storeId: string) {
  const [s] = await getDb().select().from(stores).where(eq(stores.id, storeId)).limit(1);
  return s ?? null;
}

export async function listStations(storeId: string) {
  return getDb()
    .select()
    .from(stations)
    .where(and(eq(stations.storeId, storeId), eq(stations.active, true)))
    .orderBy(asc(stations.sortOrder));
}
