import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, generateKeyPairSync } from "node:crypto";

// AZTrade identity bridge (A-Zee side): RS256 tokens, live-session introspection, immediate downgrades, service auth.
const state = vi.hoisted(() => ({
  sessions: new Map<string, { user_id: string; revoked: boolean }>(),
  verified: new Map<string, boolean>(),
  plan: "free", dbDown: false,
}));
const pool = vi.hoisted(() => ({
  query: vi.fn(async (sql: unknown, v: any[] = []) => {
    if (state.dbDown) throw new Error("db down");
    if (String(sql).includes("FROM user_sessions s JOIN users u")) {
      const s = state.sessions.get(v[0]);
      return { rows: s && !s.revoked && state.verified.get(s.user_id) ? [{ user_id: s.user_id }] : [] };
    }
    return { rows: [] };
  }),
}));
vi.mock("@/lib/admin/db", () => ({ pool }));
vi.mock("@/lib/plans", () => ({ resolvePlan: async () => state.plan }));
vi.mock("@/lib/users/auth", async () => {
  const { createHash } = await import("node:crypto");
  return { sha: (v: string) => createHash("sha256").update(v).digest("hex"), tokenFrom: (r: Request) => r.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? null, allow: async () => true };
});

import { aztradeConfig, AztradeUnavailable, introspect, jwksFor, lookupLiveSession, mintToken, serviceAuthorized, tenantFor } from "@/lib/aztrade/identity";
import { JwtError, loadKeyring, signJwt, verifyJwt } from "@/lib/aztrade/jwt";

const pem = (bits: number) => generateKeyPairSync("rsa", { modulusLength: bits, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const KEY = pem(2048);
const OLD = pem(2048);
const SECRET = "s".repeat(40);
const ENV = { AZEE_JWT_ISSUER: "https://azee.example", AZEE_JWT_AUDIENCE: "aztrade-api", AZTRADE_SERVICE_SECRET: SECRET, AZTRADE_JWT_PRIVATE_KEY: KEY.privateKey, AZTRADE_JWT_KID: "k1" };
const config = () => aztradeConfig(ENV);
const SESSION = "a".repeat(64);
const sha = (v: string) => require("node:crypto").createHash("sha256").update(v).digest("hex");
const request = (token = SESSION) => new Request("http://localhost/api/aztrade/token", { method: "POST", headers: { authorization: `Bearer ${token}` } });
const b64u = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const claims = (over: object = {}, now = Date.now()) => { const iat = Math.floor(now / 1000); return { iss: "https://azee.example", aud: "aztrade-api", sub: "user-1", jti: "j1", sid: sha(SESSION), iat, exp: iat + 300, ...over }; };
const VERIFY = { issuer: "https://azee.example", audience: "aztrade-api", maxAgeSeconds: 360 };

beforeEach(() => {
  state.sessions.clear(); state.verified.clear(); state.plan = "free"; state.dbDown = false;
  state.sessions.set(sha(SESSION), { user_id: "user-1", revoked: false }); state.verified.set("user-1", true);
});

describe("RS256 tokens", () => {
  const ring = () => loadKeyring(ENV);
  it("round-trips a valid token", () => expect(verifyJwt(ring(), signJwt(ring(), claims()), VERIFY)).toMatchObject({ sub: "user-1", sid: sha(SESSION) }));
  it("rejects a tampered payload, a tampered signature and a truncated token", () => {
    const t = signJwt(ring(), claims()); const [h, p, s] = t.split(".");
    expect(() => verifyJwt(ring(), `${h}.${b64u(claims({ sub: "admin" }))}.${s}`, VERIFY)).toThrow(/bad_signature/);
    expect(() => verifyJwt(ring(), `${h}.${p}.${s.slice(0, -4)}AAAA`, VERIFY)).toThrow(/bad_signature/);
    expect(() => verifyJwt(ring(), `${h}.${p}`, VERIFY)).toThrow(/malformed/);
    expect(() => verifyJwt(ring(), "x".repeat(9000), VERIFY)).toThrow(/malformed/);
  });
  it("rejects alg none, alg confusion (HS256 keyed with the public key) and other header tricks", () => {
    const body = b64u(claims());
    expect(() => verifyJwt(ring(), `${b64u({ alg: "none", typ: "JWT", kid: "k1" })}.${body}.`, VERIFY)).toThrow(/bad_header/);
    const hs = b64u({ alg: "HS256", typ: "JWT", kid: "k1" });
    const forged = createHmac("sha256", KEY.publicKey).update(`${hs}.${body}`).digest("base64url");
    expect(() => verifyJwt(ring(), `${hs}.${body}.${forged}`, VERIFY)).toThrow(/bad_header/);
    for (const extra of [{ jku: "http://evil/keys" }, { jwk: {} }, { x5u: "http://evil" }, { crit: ["x"] }])
      expect(() => verifyJwt(ring(), `${b64u({ alg: "RS256", typ: "JWT", kid: "k1", ...extra })}.${body}.AAAA`, VERIFY)).toThrow(/bad_header/);
  });
  it("rejects unknown key ids, wrong issuer, wrong audience, missing claims", () => {
    const bad = (o: object) => () => verifyJwt(ring(), signJwt(ring(), claims(o)), VERIFY);
    expect(bad({ iss: "https://evil" })).toThrow(/bad_issuer/);
    expect(bad({ aud: "other" })).toThrow(/bad_audience/);
    expect(bad({ sid: undefined })).toThrow(/incomplete/);
    expect(bad({ jti: "" })).toThrow(/incomplete/);
    const other = loadKeyring({ ...ENV, AZTRADE_JWT_KID: "k-unknown" });
    expect(() => verifyJwt(ring(), signJwt(other, claims()), VERIFY)).toThrow(/unknown_key/);
  });
  it("enforces expiry, issue time and maximum age", () => {
    const now = Date.now();
    expect(() => verifyJwt(ring(), signJwt(ring(), claims({}, now - 700_000)), { ...VERIFY, now })).toThrow(/expired|too_old/);
    expect(() => verifyJwt(ring(), signJwt(ring(), claims({ iat: Math.floor(now / 1000) + 600 }, now)), { ...VERIFY, now })).toThrow(/issued_in_future/);
    const old = signJwt(ring(), claims({ exp: Math.floor(now / 1000) + 3600 }, now - 400_000));
    expect(() => verifyJwt(ring(), old, { ...VERIFY, now })).toThrow(/too_old/);
  });
  it("honours previous keys during a rotation and publishes only public parameters", () => {
    const oldRing = loadKeyring({ ...ENV, AZTRADE_JWT_PRIVATE_KEY: OLD.privateKey, AZTRADE_JWT_KID: "k0" });
    const token = signJwt(oldRing, claims());
    expect(() => verifyJwt(ring(), token, VERIFY)).toThrow(/unknown_key/);
    const rotating = loadKeyring({ ...ENV, AZTRADE_JWT_PREVIOUS_PUBLIC_KEYS: JSON.stringify([{ kid: "k0", pem: OLD.publicKey }]) });
    expect(verifyJwt(rotating, token, VERIFY).sub).toBe("user-1");
    const jwks = jwksFor({ ...config(), ring: rotating });
    expect(jwks.keys.map((k: any) => k.kid)).toEqual(["k1", "k0"]);
    for (const k of jwks.keys as any[]) { expect(k).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" }); for (const secret of ["d", "p", "q", "dp", "dq", "qi"]) expect(k).not.toHaveProperty(secret); }
  });
  it("refuses weak or missing keys, so the feature stays off", () => {
    expect(() => loadKeyring({ ...ENV, AZTRADE_JWT_PRIVATE_KEY: pem(1024).privateKey })).toThrow(/at least 2048/);
    expect(() => loadKeyring({ ...ENV, AZTRADE_JWT_PRIVATE_KEY: undefined })).toThrow(/not configured/);
    expect(() => loadKeyring({ ...ENV, AZTRADE_JWT_KID: "bad kid!" })).toThrow(/not configured/);
    expect(() => aztradeConfig({ ...ENV, AZTRADE_SERVICE_SECRET: "short" })).toThrow(AztradeUnavailable);
    expect(() => aztradeConfig({ ...ENV, AZEE_JWT_ISSUER: undefined })).toThrow(AztradeUnavailable);
    expect(() => aztradeConfig({ ...ENV, AZTRADE_JWT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----" })).toThrow(AztradeUnavailable);
  });
});

describe("minting is bound to the live session", () => {
  it("mints a 5-minute token whose identity comes from the session store, and whose sid is the session's hash", async () => {
    const t = await mintToken(request(), config());
    expect(t).toMatchObject({ token_type: "Bearer", expires_in: 300 });
    const p = verifyJwt(loadKeyring(ENV), t.access_token, VERIFY);
    expect(p).toMatchObject({ sub: "user-1", sid: sha(SESSION), aud: "aztrade-api", iss: "https://azee.example" });
    expect(p.exp - p.iat).toBe(300);
    expect(Object.keys(p).sort()).toEqual(["aud", "exp", "iat", "iss", "jti", "sid", "sub"]);          // no tier, plan or tenant claims to trust
  });
  it("refuses with no session, a revoked session or an unverified account; each token has its own jti", async () => {
    await expect(mintToken(new Request("http://x"), config())).rejects.toBeInstanceOf(JwtError);
    await expect(mintToken(request("b".repeat(64)), config())).rejects.toBeInstanceOf(JwtError);
    state.verified.set("user-1", false);
    await expect(mintToken(request(), config())).rejects.toBeInstanceOf(JwtError);
    state.verified.set("user-1", true);
    const a = verifyJwt(loadKeyring(ENV), (await mintToken(request(), config())).access_token, VERIFY), b = verifyJwt(loadKeyring(ENV), (await mintToken(request(), config())).access_token, VERIFY);
    expect(a.jti).not.toBe(b.jti);
  });
  it("lookupLiveSession rejects anything that is not a 64-hex session hash", async () => {
    for (const bad of ["", "x", "a".repeat(63), "A".repeat(64), "a".repeat(64) + "x", "' OR 1=1 --"]) expect(await lookupLiveSession(bad)).toEqual({ active: false });
    expect(pool.query).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(["' OR 1=1 --"]));
  });
});

describe("introspection answers from live state on every call", () => {
  const token = async () => (await mintToken(request(), config())).access_token;
  it("active with tenant, plan and tier; the personal tenant is derived from the user id", async () => {
    const r = await introspect(await token(), config());
    expect(r).toMatchObject({ active: true, session_active: true, sub: "user-1", tenant_id: tenantFor("user-1"), plan: "free", tier: "free", subscription_status: "active" });
    expect(tenantFor("user-1")).toBe("azee-user:user-1");
  });
  it("sign-out takes effect on the very next call", async () => {
    const t = await token();
    expect((await introspect(t, config())).active).toBe(true);
    state.sessions.get(sha(SESSION))!.revoked = true;
    expect(await introspect(t, config())).toEqual({ active: false });
  });
  it("an unverified or deleted account is inactive", async () => {
    const t = await token(); state.verified.set("user-1", false);
    expect(await introspect(t, config())).toEqual({ active: false });
    state.sessions.delete(sha(SESSION));
    expect(await introspect(t, config())).toEqual({ active: false });
  });
  it("maps A-Zee's REAL plan ids to tiers, and a downgrade applies immediately", async () => {
    const t = await token();
    const tierOf = async (plan: string) => { state.plan = plan; const r = await introspect(t, config()); return r.active ? r.tier : "inactive"; };
    expect([await tierOf("free"), await tierOf("go"), await tierOf("plus"), await tierOf("pro25"), await tierOf("pro60"), await tierOf("pro500"), await tierOf("business"), await tierOf("enterprise"), await tierOf("mystery")])
      .toEqual(["free", "plus", "plus", "premium", "premium", "premium", "premium", "premium", "free"]);
    state.plan = "premium-ish"; state.plan = "pro25";
    expect((await introspect(t, config()) as any).tier).toBe("premium");
    state.plan = "free";                                           // the subscription lapses
    expect((await introspect(t, config()) as any).tier).toBe("free");
  });
  it("garbage, forged, expired and wrong-audience tokens are inactive; infrastructure failure throws (the route answers 503)", async () => {
    expect(await introspect("garbage", config())).toEqual({ active: false });
    const other = loadKeyring({ ...ENV, AZTRADE_JWT_PRIVATE_KEY: OLD.privateKey });
    expect(await introspect(signJwt(other, claims()), config())).toEqual({ active: false });
    expect(await introspect(signJwt(loadKeyring(ENV), claims({ aud: "x" })), config())).toEqual({ active: false });
    expect(await introspect(await token(), config(), Date.now() + 3_600_000)).toEqual({ active: false });
    const t = await token(); state.dbDown = true;
    await expect(introspect(t, config())).rejects.toThrow("db down");
  });
  it("a token for one user cannot be replayed against another user's session", async () => {
    state.sessions.set(sha("c".repeat(64)), { user_id: "user-2", revoked: false }); state.verified.set("user-2", true);
    const forged = signJwt(loadKeyring(ENV), claims({ sub: "user-2" }));                 // validly signed, but sid belongs to user-1
    expect(await introspect(forged, config())).toEqual({ active: false });
  });
});

describe("service credential", () => {
  const req = (auth?: string) => new Request("http://x", { headers: auth ? { authorization: auth } : {} });
  it("accepts only the exact dedicated credential", () => {
    expect(serviceAuthorized(req(`Bearer ${SECRET}`), config())).toBe(true);
    for (const a of [undefined, "", "Bearer ", `Bearer ${SECRET}x`, `bearer ${SECRET}`, `Bearer ${"t".repeat(40)}`, SECRET, "Bearer a"]) expect(serviceAuthorized(req(a), config())).toBe(false);
  });
});
