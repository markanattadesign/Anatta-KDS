export type DomainErrorCode = "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "INVALID" | "UNAUTHORIZED";

const STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  INVALID: 422,
  UNAUTHORIZED: 401,
};

export class DomainError extends Error {
  readonly status: number;
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new DomainError("NOT_FOUND", `${what} not found`);
export const conflict = (msg: string, details?: unknown) => new DomainError("CONFLICT", msg, details);
export const invalid = (msg: string, details?: unknown) => new DomainError("INVALID", msg, details);
export const forbidden = (msg = "You don't have access to this") => new DomainError("FORBIDDEN", msg);

export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}
