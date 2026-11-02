// ============================================================
// 15_ADMIN / HTTP ERROR HANDLING
// ============================================================
import "server-only";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = "AppError";
  }
}

export function fail(status: number, code: string, details?: unknown): never {
  throw new AppError(status, code, details);
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function endpoint(handler: () => Promise<Response>) {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json(
        { error: error.code, details: error.details ?? null },
        { status: error.status, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (error instanceof ZodError) {
      return Response.json(
        { error: "INVALID_INPUT", issues: error.issues },
        { status: 422, headers: { "Cache-Control": "no-store" } }
      );
    }

    return Response.json(
      { error: "INTERNAL_ERROR" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
