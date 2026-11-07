//tests/chat-route.test.ts
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { POST } from "@/app/api/chat/route";
import { health } from "@/lib/pipeline/registry";

describe("public chat route", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.CHAT_DEMO_MODE; });
  beforeEach(() => {
    health.reset();
    for (const k of ["GEMINI_API_KEY", "GROQ_API_KEY", "MISTRALAI_API_KEY", "OPENROUTERAI_API_KEY", "TOGETHERAI_API_KEY", "PIPELINE_API_URL"]) delete process.env[k];
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.APP_ORIGIN;
    delete process.env.DATABASE_URL;
    process.env.CHAT_DEMO_MODE = "true";
  });

  it("does not pretend a demo answer is a real provider response", async () => {
    delete process.env.CHAT_DEMO_MODE;
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "AI_PROVIDER_NOT_CONFIGURED" });
  });

  it("returns a provider error rather than a client-input error when all providers fail", async () => {
    process.env.OPENAI_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
    }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "AI_PROVIDER_UNAVAILABLE" });
  });

  it("rejects a message exceeding the shared UI/API limit", async () => {
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "a".repeat(20001) }] }),
    }));
    expect(response.status).toBe(422);
  });
  it("returns a markdown answer shape for the requested chat payload", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          model: "auto",
          messages: [{ role: "user", content: "Help me plan the next sprint." }],
        }),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toHaveProperty("data.answer");
    expect(String(payload.data.answer)).toContain("# CHAT response");
    expect(String(payload.data.answer)).toContain("Mode: **chat**");
  });

  it("falls through to the next provider when the preferred one is unavailable", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (href.endsWith("/v1/moderations")) return json({ results: [{ flagged: false }] });
      if (href.startsWith("https://api.openai.com/v1/responses")) return json({ error: { message: "quota exhausted" } }, 429);
      if (href === "https://api.anthropic.com/v1/messages") return json({ content: [{ text: "Anthropic routed response" }] });
      throw new Error(`unexpected ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const response = await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "code",
            model: "code",
            messages: [{ role: "user", content: "Generate a quick API wrapper" }],
          }),
        })
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.data.answer).toBe("Anthropic routed response");
      expect(payload.data.pipeline).toMatchObject({ task: "code" });
      expect(payload.data.pipeline).not.toHaveProperty("provider");
      expect(payload.data.pipeline).not.toHaveProperty("attempts");
      const modelCalls = fetchMock.mock.calls.map(([u]) => String(u instanceof Request ? u.url : u)).filter(u => !u.endsWith("/v1/moderations"));
      expect(modelCalls).toEqual(["https://api.openai.com/v1/responses", "https://api.anthropic.com/v1/messages"]);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});
