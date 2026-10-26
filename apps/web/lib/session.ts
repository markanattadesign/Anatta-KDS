import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: string;
  name?: string;
  email?: string;
}

function options(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return {
    password,
    cookieName: "kds_session",
    ttl: 60 * 60 * 14, // one long shift
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), options());
}
