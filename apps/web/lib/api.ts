import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import type { Role } from "@kds/contracts";
import { DomainError, hasRoleAnywhere, requireStoreRole } from "@kds/domain";
import { getSession } from "./session";

export type RouteCtx<P> = { params: Promise<P> };

/** Wraps a route handler: maps domain/validation errors to JSON responses. */
export function handle<P>(fn: (req: Request, params: P) => Promise<unknown>) {
  return async (req: Request, ctx: RouteCtx<P>) => {
    try {
      const params = await ctx.params;
      const result = await fn(req, params);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof DomainError) {
        return NextResponse.json({ error: e.message, code: e.code, details: e.details }, { status: e.status });
      }
      if (e instanceof ZodError) {
        return NextResponse.json({ error: "Invalid request", code: "INVALID", details: e.flatten() }, { status: 422 });
      }
      console.error("[api]", req.method, req.url, e);
      return NextResponse.json({ error: "Something went wrong", code: "INTERNAL" }, { status: 500 });
    }
  };
}

/** Current user, or a 401. */
export async function requireUser() {
  const s = await getSession();
  if (!s.userId) throw new DomainError("UNAUTHORIZED", "Please sign in");
  return { id: s.userId, name: s.name ?? "", email: s.email ?? "" };
}

/** Current user with at least `minRole` in the store, or 401/403. */
export async function requireStoreUser(storeId: string, minRole: Role) {
  const user = await requireUser();
  const role = await requireStoreRole(user.id, storeId, minRole);
  return { ...user, role };
}

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let json: unknown = {};
  const text = await req.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new DomainError("INVALID", "Body must be JSON");
    }
  }
  return schema.parse(json);
}

/** Recipe admin is store-agnostic: MANAGER or ADMIN in any store. */
export async function requireRecipeAdmin() {
  const user = await requireUser();
  if (!(await hasRoleAnywhere(user.id, "MANAGER"))) throw new DomainError("FORBIDDEN", "Requires MANAGER role or higher");
  return user;
}
