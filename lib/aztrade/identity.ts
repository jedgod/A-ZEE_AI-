import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { pool } from "@/lib/admin/db";
import { tierForPlan, type Tier } from "@/lib/linqext/policy";
import { resolvePlan } from "@/lib/plans";
import { sha, tokenFrom } from "@/lib/users/auth";
import { JwtError, loadKeyring, publicJwks, signJwt, verifyJwt, type Keyring } from "./jwt";

// AZTrade identity bridge, A-Zee side. A-Zee is the only identity authority: it mints short-lived RS256 tokens for a
// live signed-in session, and answers introspection from its REAL session store and billing on every call, so signing
// out or downgrading takes effect on the very next AZTrade request. Nothing in a token is trusted for entitlements.

export const TOKEN_TTL_SECONDS = 300;
export const MAX_TOKEN_AGE_SECONDS = 360;

export class AztradeUnavailable extends Error { constructor(why = "AZTrade identity is not configured") { super(why); } }

export type AztradeConfig = { issuer: string; audience: string; ring: Keyring; serviceSecret: string };

/** Reads the configuration, or throws AztradeUnavailable: with anything missing or weak the feature stays off (fail closed). */
export function aztradeConfig(env: Record<string, string | undefined> = process.env): AztradeConfig {
  const issuer = env.AZEE_JWT_ISSUER;
  const audience = env.AZEE_JWT_AUDIENCE || "aztrade-api";
  const serviceSecret = env.AZTRADE_SERVICE_SECRET;
  if (!issuer || !/^https?:\/\//.test(issuer)) throw new AztradeUnavailable("AZEE_JWT_ISSUER missing");
  if (!serviceSecret || serviceSecret.length < 32) throw new AztradeUnavailable("AZTRADE_SERVICE_SECRET must be at least 32 characters");
  let ring: Keyring;
  try { ring = loadKeyring(env); } catch (e) { throw new AztradeUnavailable((e as Error).message); }
  return { issuer, audience, ring, serviceSecret };
}

/** Each A-Zee account is its own tenant for now; organisations can later share one without changing AZTrade. */
export const tenantFor = (userId: string) => `azee-user:${userId}`;

export const jwksFor = (config: AztradeConfig = aztradeConfig()) => publicJwks(config.ring);

// ---- the two adapters the integration requires, wired to A-Zee's real stores ----

export type LiveSession = { active: boolean; userId?: string; tenantId?: string };

/** Reads the real session store on EVERY call. A signed-out, revoked, expired or unverified session is not active. */
export async function lookupLiveSession(sid: string): Promise<LiveSession> {
  if (typeof sid !== "string" || !/^[a-f0-9]{64}$/.test(sid)) return { active: false };
  const r = await pool.query(
    `SELECT s.user_id FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.email_verified_at IS NOT NULL`, [sid]);
  const row = r.rows[0];
  return row ? { active: true, userId: row.user_id, tenantId: tenantFor(row.user_id) } : { active: false };
}

export type Subscription = { plan: string; status: "active"; tier: Tier };

/** The account's current plan from A-Zee's authoritative subscription resolver (active or trialing, period not ended). */
export async function lookupSubscription(userId: string): Promise<Subscription> {
  const plan = await resolvePlan({ key: `account:${userId}`, accountId: userId });
  return { plan, status: "active", tier: tierForPlan(plan) };
}

// ---- mint and introspect ----

/** Mints a 5-minute token for the CURRENT live session. The identity comes only from the session store, never from the request body. */
export async function mintToken(request: Request, config: AztradeConfig = aztradeConfig(), now = Date.now()) {
  const secret = tokenFrom(request);
  if (!secret) throw new JwtError("no_session");
  const sid = sha(secret);
  const session = await lookupLiveSession(sid);
  if (!session.active || !session.userId) throw new JwtError("inactive_session");
  const iat = Math.floor(now / 1000);
  const accessToken = signJwt(config.ring, { iss: config.issuer, aud: config.audience, sub: session.userId, jti: randomUUID(), sid, iat, exp: iat + TOKEN_TTL_SECONDS });
  return { access_token: accessToken, token_type: "Bearer", expires_in: TOKEN_TTL_SECONDS };
}

export type Introspection =
  | { active: false }
  | { active: true; session_active: true; sub: string; jti: string; sid: string; tenant_id: string; plan: string; tier: Tier; subscription_status: "active" };

/** Verifies the token, then re-checks the live session and subscription. Throws only on infrastructure failure (caller answers 503). */
export async function introspect(token: string, config: AztradeConfig = aztradeConfig(), now = Date.now()): Promise<Introspection> {
  let payload: Record<string, any>;
  try { payload = verifyJwt(config.ring, token, { issuer: config.issuer, audience: config.audience, now, maxAgeSeconds: MAX_TOKEN_AGE_SECONDS }); }
  catch { return { active: false }; }
  const session = await lookupLiveSession(payload.sid);
  if (!session.active || session.userId !== payload.sub || !session.tenantId) return { active: false };
  const subscription = await lookupSubscription(payload.sub);
  return { active: true, session_active: true, sub: payload.sub, jti: payload.jti, sid: payload.sid, tenant_id: session.tenantId, plan: subscription.plan, tier: subscription.tier, subscription_status: subscription.status };
}

/** Constant-time check of the dedicated service credential (compares fixed-length digests, so length leaks nothing). */
export function serviceAuthorized(request: Request, config: AztradeConfig): boolean {
  const presented = request.headers.get("authorization") ?? "";
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(`Bearer ${config.serviceSecret}`).digest();
  return timingSafeEqual(a, b);
}
