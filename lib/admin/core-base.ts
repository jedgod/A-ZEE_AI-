import "server-only";
import { pool as pgPool, transaction } from "./db";
import { endpoint as handleEndpoint, json as jsonResponse, fail as raise } from "./errors";
import { sameOrigin as enforceSameOrigin, rateLimit as enforceRateLimit, readBody } from "./security";

export const pool = pgPool;
export const tx = transaction;
export const endpoint = handleEndpoint;
export const json = jsonResponse;
export const fail = raise;

export function deny(status: number, code: string, details?: unknown): never {
  raise(status, code, details);
}

export async function body(request: Request) {
  return readBody(request);
}

export const sameOrigin = enforceSameOrigin;
export const rateLimit = enforceRateLimit;
