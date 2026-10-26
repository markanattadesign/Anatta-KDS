export function fmtTime(d: string | Date, timeZone?: string) {
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

export function fmtDateTime(d: string | Date, timeZone?: string) {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

/** "12m", "1h 05m", "-3m" (late). */
export function fmtMinutes(ms: number) {
  const neg = ms < 0;
  const m = Math.floor(Math.abs(ms) / 60_000);
  const s = m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
  return neg ? `-${s}` : s;
}

export function fmtDuration(sec: number | null | undefined) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export type Urgency = "ok" | "soon" | "late";

/** Urgency from time left until the promise time: late, under 15 min, or fine. */
export function urgency(promisedAt: string | Date, now: number): Urgency {
  const left = new Date(promisedAt).getTime() - now;
  if (left < 0) return "late";
  if (left < 15 * 60_000) return "soon";
  return "ok";
}

export const label = (s: string) => s.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
