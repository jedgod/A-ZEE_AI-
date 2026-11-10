import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { AddressInfo } from "node:net";
import { createFakeOllama } from "../scripts/staging/fake-ollama.mjs";
import { checkOllama, createMonitor } from "../scripts/staging/ollama-tunnel-health.mjs";

// Uses the labelled MOCK Ollama fixture: this tests the monitor's decisions, not any real model or tunnel.
const DIGEST = "sha256:" + "a".repeat(64); let srv: ReturnType<typeof createFakeOllama>; let base = ""; let ctl: (p: string, body: object) => Promise<unknown>;
beforeAll(async () => {
  srv = createFakeOllama(); await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok)); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  ctl = (p, body) => fetch(base + p, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
  await ctl("/__digest", { digest: DIGEST });
});
afterAll(() => { srv.close(); srv.closeAllConnections(); });

describe("checkOllama", () => {
  it("accepts exactly the pinned local model on a loopback endpoint", async () => { expect(await checkOllama({ baseUrl: base, model: "qwen2.5:1.5b", digest: DIGEST })).toEqual({ ok: true, model: "qwen2.5:1.5b" }); });
  it("refuses a changed digest, a missing model and an unpinned configuration", async () => {
    expect(await checkOllama({ baseUrl: base, model: "qwen2.5:1.5b", digest: "sha256:" + "b".repeat(64) })).toEqual({ ok: false, reason: "digest_mismatch" });
    expect(await checkOllama({ baseUrl: base, model: "other:7b", digest: DIGEST })).toEqual({ ok: false, reason: "model_missing" });
    expect(await checkOllama({ baseUrl: base, model: "qwen2.5:1.5b" })).toEqual({ ok: false, reason: "model_or_digest_not_pinned" });
  });
  it("refuses a cloud alias even when it is 'installed'", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ models: [{ name: "qwen3:cloud", digest: DIGEST }] }))) as typeof fetch;
    expect(await checkOllama({ baseUrl: base, model: "qwen3:cloud", digest: DIGEST, fetchImpl })).toEqual({ ok: false, reason: "remote_model" });
    const remote = (async () => new Response(JSON.stringify({ models: [{ name: "m", digest: DIGEST, remote_host: "https://ollama.com" }] }))) as typeof fetch;
    expect(await checkOllama({ baseUrl: base, model: "m", digest: DIGEST, fetchImpl: remote })).toEqual({ ok: false, reason: "remote_model" });
  });
  it("only ever talks to a numeric loopback endpoint (no DNS names, no remote hosts, no credentials, no TLS-less internet)", async () => {
    for (const u of ["http://example.com:11434", "http://10.0.0.5:11434", "http://localhost:11434", "https://127.0.0.1:11434", "http://user:pw@127.0.0.1:11434", "not a url"])
      expect((await checkOllama({ baseUrl: u, model: "m", digest: DIGEST })).ok, u).toBe(false);
  });
  it("reports unreachable (tunnel down) and bad responses without echoing any body", async () => {
    expect(await checkOllama({ baseUrl: "http://127.0.0.1:1", model: "m", digest: DIGEST, timeoutMs: 500 })).toEqual({ ok: false, reason: "unreachable" });
    const bad = (async () => new Response("secret body", { status: 200 })) as typeof fetch; const r = await checkOllama({ baseUrl: base, model: "m", digest: DIGEST, fetchImpl: bad });
    expect(r).toEqual({ ok: false, reason: "invalid_response" }); expect(JSON.stringify(r)).not.toContain("secret");
  });
});

describe("monitor", () => {
  const make = (results: { ok: boolean; reason?: string }[]) => { let i = 0; const alerts: any[] = []; const snaps: any[] = []; let t = 5_000;
    const m = createMonitor({ check: async () => results[Math.min(i++, results.length - 1)], now: () => (t += 1000), alertAfter: 2, owner: "o", runbook: "r.md", sink: (a) => alerts.push(a), writeStatus: (s) => snaps.push(s) }); return { m, alerts, snaps }; };
  it("alerts after consecutive outages (not on one blip), reports AI unavailable meanwhile, and announces recovery", async () => {
    const { m, alerts, snaps } = make([{ ok: true }, { ok: false, reason: "unreachable" }, { ok: false, reason: "unreachable" }, { ok: false, reason: "unreachable" }, { ok: true }]);
    await m.tick(); await m.tick(); expect(alerts).toHaveLength(0); await m.tick();
    expect(alerts).toHaveLength(1); expect(alerts[0]).toMatchObject({ severity: "major", event: "ollama_endpoint_unhealthy", owner: "o", runbook: "r.md", detail: { reason: "unreachable" } });
    await m.tick(); expect(alerts).toHaveLength(1); expect(snaps.at(-1)).toMatchObject({ healthy: false, aiAvailable: false });   // no alert storm
    await m.tick(); expect(alerts.map((a) => a.event)).toEqual(["ollama_endpoint_unhealthy", "ollama_endpoint_recovered"]); expect(snaps.at(-1).aiAvailable).toBe(true);
  });
  it("treats a changed model, a cloud alias or a wrong endpoint as a critical event immediately", async () => {
    for (const reason of ["digest_mismatch", "remote_model", "non_loopback_endpoint", "model_missing"]) { const { m, alerts } = make([{ ok: false, reason }]); await m.tick(); expect(alerts[0], reason).toMatchObject({ severity: "critical" }); }
  });
});
