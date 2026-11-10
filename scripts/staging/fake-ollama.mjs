#!/usr/bin/env node
// *** TEST FIXTURE, NOT A MODEL ***  A deterministic stand-in for Ollama's HTTP API so the A-Zee gateway integration (routing, digest pinning,
// metering, refunds, fail-closed behavior) can be exercised on a machine where no model is installed. It performs NO inference: every
// reply is a fixed string that says so. Results obtained with it prove the integration plumbing only, never model quality or capacity.
//   FAKE_OLLAMA_PORT=11435 FAKE_OLLAMA_MODEL=qwen2.5:1.5b FAKE_OLLAMA_DIGEST=sha256:<hex> node scripts/staging/fake-ollama.mjs
//   Control (loopback only): POST /__mode {"mode":"ok|fail|slow|bad-json|empty"}   GET /__stats -> {tags,chat,lastModelRequested}
import http from "node:http";

const port = Number(process.env.FAKE_OLLAMA_PORT || 11435), model = process.env.FAKE_OLLAMA_MODEL || "qwen2.5:1.5b";
let digest = process.env.FAKE_OLLAMA_DIGEST || "sha256:" + "f".repeat(64);
let mode = "ok"; const stats = { tags: 0, chat: 0, lastModelRequested: null };

export function createFakeOllama() {
  return http.createServer((req, res) => {
    const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
      if (req.method === "GET" && req.url === "/api/tags") { stats.tags++; return json(200, { models: [{ name: model, model, digest, size: 986_000_000, details: { family: "qwen2", parameter_size: "1.5B", quantization_level: "Q4_K_M" } }] }); }
      if (req.method === "GET" && req.url === "/__stats") return json(200, stats);
      if (req.method === "POST" && req.url === "/__digest") { try { digest = JSON.parse(raw).digest; } catch { return json(400, {}); } return json(200, { digest }); }
      if (req.method === "POST" && req.url === "/__mode") { try { mode = JSON.parse(raw).mode; } catch { return json(400, {}); } return json(200, { mode }); }
      if (req.method === "POST" && req.url === "/api/chat") {
        stats.chat++; let body = {}; try { body = JSON.parse(raw); } catch { /* ignore */ } stats.lastModelRequested = body.model ?? null;
        if (mode === "fail") return json(500, { error: "fixture failure" });
        if (mode === "bad-json") { res.writeHead(200); return res.end("not json"); }
        if (mode === "empty") return json(200, { done: true, message: { role: "assistant", content: "  " } });
        const answer = () => json(200, { model: body.model, done: true, message: { role: "assistant", content: "[FIXTURE] No model ran: this is a fixed test reply." } });
        return mode === "slow" ? setTimeout(answer, 30_000) : answer();
      }
      json(404, {});
    });
  });
}
if (process.argv[1]?.endsWith("fake-ollama.mjs")) createFakeOllama().listen(port, "127.0.0.1", () => console.log(JSON.stringify({ type: "fake_ollama_started", port, model, fixture: true })));
