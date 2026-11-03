import "server-only";
import { pool } from "@/lib/admin/db";
import { featureEnabled } from "@/lib/features";
import { decrypt, encrypt, pkceChallenge, randomToken, sha256, tokenKeyConfigured } from "./crypto";
import { githubProvider } from "./github";
import { googleDriveProvider } from "./google-drive";
import { ConnectorError, type ConnectorProvider, type ProviderId, type TokenSet } from "./types";

// Connector lifecycle: start (single-use state + PKCE verifier) → callback (validate, exchange,
// encrypt, store) → use (refresh when expired) → disconnect (revoke, delete). All audited.

const STATE_TTL_MINUTES = 10;

export const providers = (fetchImpl: typeof fetch = fetch) => ({ github: githubProvider(fetchImpl), google_drive: googleDriveProvider(fetchImpl) });
export const PROVIDER_IDS: ProviderId[] = ["github", "google_drive"];
export const isProvider = (v: string): v is ProviderId => (PROVIDER_IDS as string[]).includes(v);

const appOrigin = () => (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
export const redirectUri = (provider: ProviderId) => `${appOrigin()}/api/connectors/${provider}/callback`;

export async function audit(ownerId: string, provider: string, action: string, outcome: "success" | "failure" | "denied", resource?: string | null, detail?: string | null) {
  await pool.query(
    `INSERT INTO connector_audit (owner_id, provider, action, resource, outcome, detail) VALUES ($1, $2, $3, $4, $5, $6)`,
    [ownerId, provider, action.slice(0, 40), resource?.slice(0, 500) ?? null, outcome, detail?.slice(0, 300) ?? null]).catch(() => {});
}

function ready(provider: ConnectorProvider) {
  if (!featureEnabled("connectors")) throw new ConnectorError(404, "FEATURE_DISABLED");
  if (!tokenKeyConfigured()) throw new ConnectorError(503, "CONNECTOR_KEY_MISSING", "Set CONNECTOR_TOKEN_KEY (32 random bytes, base64) in .env.local.");
  if (!provider.configured()) throw new ConnectorError(503, "PROVIDER_NOT_CONFIGURED", `Set ${provider.requiredEnv.join(" and ")} in .env.local.`);
}

/** Status of each provider for this owner (never includes tokens). */
export async function statuses(ownerId: string, fetchImpl: typeof fetch = fetch) {
  const all = providers(fetchImpl);
  const { rows } = await pool.query(`SELECT provider, external_login, scopes, created_at, updated_at FROM connector_accounts WHERE owner_id = $1`, [ownerId]);
  return PROVIDER_IDS.map(id => {
    const p = all[id];
    const row = rows.find(r => r.provider === id);
    return {
      id, label: p.label, scopes: p.scopes, requiredEnv: p.requiredEnv,
      keyConfigured: tokenKeyConfigured(), configured: p.configured(), enabled: featureEnabled("connectors"),
      connected: Boolean(row), account: row?.external_login ?? null, grantedScopes: row?.scopes ?? [],
      connectedAt: row ? new Date(row.created_at).toISOString() : null,
    };
  });
}

export async function startConnect(ownerId: string, id: ProviderId, fetchImpl: typeof fetch = fetch) {
  const provider = providers(fetchImpl)[id];
  ready(provider);
  const state = randomToken(32);
  const verifier = randomToken(48);
  await pool.query(`DELETE FROM connector_oauth_states WHERE expires_at < now()`);
  await pool.query(
    `INSERT INTO connector_oauth_states (state_hash, owner_id, provider, verifier_enc, expires_at) VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)`,
    [sha256(state), ownerId, id, encrypt(verifier), String(STATE_TTL_MINUTES)]);
  await audit(ownerId, id, "connect.start", "success");
  return { url: provider.authorizeUrl({ state, codeChallenge: pkceChallenge(verifier), redirectUri: redirectUri(id) }) };
}

/** OAuth callback: the state must exist, belong to this owner and provider, be unexpired, and is consumed. */
export async function completeConnect(ownerId: string, id: ProviderId, params: { state?: string | null; code?: string | null; error?: string | null }, fetchImpl: typeof fetch = fetch) {
  const provider = providers(fetchImpl)[id];
  ready(provider);
  if (!params.state) { await audit(ownerId, id, "connect.callback", "denied", null, "missing state"); throw new ConnectorError(400, "INVALID_STATE"); }
  const { rows } = await pool.query(
    `DELETE FROM connector_oauth_states WHERE state_hash = $1 RETURNING owner_id, provider, verifier_enc, expires_at`, [sha256(params.state)]);
  const saved = rows[0];
  if (!saved || saved.owner_id !== ownerId || saved.provider !== id || new Date(saved.expires_at) < new Date()) {
    await audit(ownerId, id, "connect.callback", "denied", null, "invalid or expired state");
    throw new ConnectorError(400, "INVALID_STATE");
  }
  if (params.error) { await audit(ownerId, id, "connect.callback", "failure", null, `provider: ${params.error}`); throw new ConnectorError(400, "AUTHORIZATION_DENIED"); }
  if (!params.code) throw new ConnectorError(400, "MISSING_CODE");
  let tokens: TokenSet;
  try {
    tokens = await provider.exchangeCode({ code: params.code, codeVerifier: decrypt(saved.verifier_enc), redirectUri: redirectUri(id) });
  } catch (error) {
    await audit(ownerId, id, "connect.exchange", "failure", null, (error as Error).message);
    throw error instanceof ConnectorError ? error : new ConnectorError(502, "OAUTH_EXCHANGE_FAILED");
  }
  const account = await provider.account(tokens.accessToken);
  await pool.query(
    `INSERT INTO connector_accounts (owner_id, provider, external_id, external_login, scopes, access_token_enc, refresh_token_enc, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (owner_id, provider) DO UPDATE SET external_id = EXCLUDED.external_id, external_login = EXCLUDED.external_login,
       scopes = EXCLUDED.scopes, access_token_enc = EXCLUDED.access_token_enc, refresh_token_enc = EXCLUDED.refresh_token_enc,
       expires_at = EXCLUDED.expires_at, updated_at = now()`,
    [ownerId, id, account.id, account.login, tokens.scopes.length ? tokens.scopes : provider.scopes, encrypt(tokens.accessToken),
      tokens.refreshToken ? encrypt(tokens.refreshToken) : null, tokens.expiresAt ?? null]);
  await audit(ownerId, id, "connect.complete", "success", account.login);
  return { account: account.login };
}

/** A usable access token for this owner, refreshed when it has expired (or is about to). */
export async function accessToken(ownerId: string, id: ProviderId, fetchImpl: typeof fetch = fetch): Promise<string> {
  const provider = providers(fetchImpl)[id];
  ready(provider);
  const { rows } = await pool.query(`SELECT * FROM connector_accounts WHERE owner_id = $1 AND provider = $2`, [ownerId, id]);
  const row = rows[0];
  if (!row) throw new ConnectorError(409, "NOT_CONNECTED");
  const expiring = row.expires_at && new Date(row.expires_at).getTime() < Date.now() + 60_000;
  if (!expiring) return decrypt(row.access_token_enc);
  if (!row.refresh_token_enc || !provider.refresh) { await audit(ownerId, id, "token.refresh", "failure", null, "expired, no refresh token"); throw new ConnectorError(401, "RECONNECT_REQUIRED"); }
  try {
    const next = await provider.refresh(decrypt(row.refresh_token_enc));
    await pool.query(
      `UPDATE connector_accounts SET access_token_enc = $3, refresh_token_enc = $4, expires_at = $5, updated_at = now() WHERE owner_id = $1 AND provider = $2`,
      [ownerId, id, encrypt(next.accessToken), next.refreshToken ? encrypt(next.refreshToken) : row.refresh_token_enc, next.expiresAt ?? null]);
    await audit(ownerId, id, "token.refresh", "success");
    return next.accessToken;
  } catch {
    await audit(ownerId, id, "token.refresh", "failure");
    throw new ConnectorError(401, "RECONNECT_REQUIRED");
  }
}

export async function disconnect(ownerId: string, id: ProviderId, fetchImpl: typeof fetch = fetch) {
  const provider = providers(fetchImpl)[id];
  const { rows } = await pool.query(`DELETE FROM connector_accounts WHERE owner_id = $1 AND provider = $2 RETURNING *`, [ownerId, id]);
  if (!rows.length) throw new ConnectorError(404, "NOT_CONNECTED");
  try {
    if (tokenKeyConfigured() && provider.revoke && provider.configured()) {
      await provider.revoke({ accessToken: decrypt(rows[0].access_token_enc), refreshToken: rows[0].refresh_token_enc ? decrypt(rows[0].refresh_token_enc) : null, scopes: rows[0].scopes });
    }
  } catch { /* revocation is best effort; the stored tokens are already deleted */ }
  await audit(ownerId, id, "disconnect", "success", rows[0].external_login);
}

/** Runs a read with a fresh token; on 401 the token is refreshed once and the read retried. Audited. */
export async function withToken<T>(ownerId: string, id: ProviderId, action: string, resource: string | null, work: (token: string) => Promise<T>, fetchImpl: typeof fetch = fetch): Promise<T> {
  try {
    const result = await work(await accessToken(ownerId, id, fetchImpl));
    await audit(ownerId, id, action, "success", resource);
    return result;
  } catch (error) {
    if (error instanceof ConnectorError && error.code === "CONNECTOR_UNAUTHORIZED") {
      await pool.query(`UPDATE connector_accounts SET expires_at = now() - interval '1 minute' WHERE owner_id = $1 AND provider = $2`, [ownerId, id]);
      try {
        const result = await work(await accessToken(ownerId, id, fetchImpl));
        await audit(ownerId, id, action, "success", resource);
        return result;
      } catch (retry) { await audit(ownerId, id, action, "failure", resource, (retry as Error).message); throw retry; }
    }
    await audit(ownerId, id, action, error instanceof ConnectorError && error.status === 403 ? "denied" : "failure", resource, (error as Error).message);
    throw error;
  }
}

export async function recentAudit(ownerId: string, limit = 30) {
  const { rows } = await pool.query(`SELECT provider, action, resource, outcome, detail, created_at FROM connector_audit WHERE owner_id = $1 ORDER BY id DESC LIMIT $2`, [ownerId, limit]);
  return rows.map(r => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}
