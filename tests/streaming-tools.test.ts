import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFrame, readChatResponse } from "@/lib/chat/sse";
import { answerChat } from "@/lib/pipeline";
import { webActor, type RequestActor } from "@/lib/pipeline/actor";
import { health } from "@/lib/pipeline/registry";
import { runToolLoop, wantsTools, withToolResults } from "@/lib/pipeline/tools";
import type { ModelAdapter } from "@/lib/reliability/contracts";

const PROVIDER_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "MISTRALAI_API_KEY", "OPENROUTERAI_API_KEY", "TOGETHERAI_API_KEY"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const chatReply = (text: string) => json({ choices: [{ message: { content: text } }] });
const local = (): RequestActor => webActor(new Request("http://localhost:3000/api/chat", { headers: { host: "localhost:3000" } }), { id: "owner-1", name: "Owner", email: "o@example.com", verified: true }).actor;
const guest = (): RequestActor => webActor(new Request("https://az.example.com/api/chat", { headers: { host: "az.example.com" } }), null).actor;
const scripted = (...replies: unknown[]): ModelAdapter & { calls: number } => {
  const adapter = { calls: 0, generate: async () => JSON.stringify(replies[adapter.calls++] ?? { action: "done" }) };
  return adapter;
};

describe("07 tool-call loop", () => {
  afterEach(() => { delete process.env.AZ_TOOL_LOOP; });

  it("runs only for arithmetic by default, and obeys AZ_TOOL_LOOP", () => {
    expect(wantsTools("What is 1234 * 56?")).toBe(true);
    expect(wantsTools("Tell me about hash maps")).toBe(false);
    process.env.AZ_TOOL_LOOP = "always";
    expect(wantsTools("Tell me about hash maps")).toBe(true);
    process.env.AZ_TOOL_LOOP = "off";
    expect(wantsTools("What is 2 + 2?")).toBe(false);
  });

  it("chains calculator calls, reports events, and stops on done", async () => {
    const adapter = scripted(
      { action: "tool", tool: "calculator", arguments: { operation: "multiply", a: 12, b: 7 } },
      { action: "tool", tool: "calculator", arguments: { operation: "add", a: 84, b: 3 } },
      { action: "done" },
    );
    const events: string[] = [];
    const results = await runToolLoop({ adapter, question: "12*7+3", auth: guest().execution, sources: [], onEvent: e => events.push(`${e.name}:${e.status}`) });
    expect(results).toEqual([
      { tool: "calculator", ok: true, output: { operation: "multiply", value: 84 } },
      { tool: "calculator", ok: true, output: { operation: "add", value: 87 } },
    ]);
    expect(events).toEqual(["calculator:running", "calculator:complete", "calculator:running", "calculator:complete"]);
    expect(withToolResults("Q", results)).toContain('2. calculator → {"operation":"add","value":87}');
  });

  it("never offers unconfigured or unpermitted tools, reports bad arguments generically, and is bounded", async () => {
    const results = await runToolLoop({
      adapter: scripted(
        { action: "tool", tool: "search", arguments: { query: "x" } },          // search not configured
        { action: "tool", tool: "code_execution", arguments: { code: "1" } },  // not registered
        { action: "tool", tool: "calculator", arguments: { operation: "divide", a: 1, b: 0 } },
        { action: "tool", tool: "calculator", arguments: { operation: "add", a: 1, b: 1 } },
        { action: "tool", tool: "calculator", arguments: { operation: "add", a: 2, b: 2 } }, // past MAX_STEPS
      ),
      question: "q", auth: guest().execution, sources: [],
    });
    expect(results.map(r => [r.tool, r.ok])).toEqual([["search", false], ["code_execution", false], ["calculator", false], ["calculator", true]]);
    expect(results[2].output).toEqual({ error: "Tool failed" });
    const none = await runToolLoop({ adapter: scripted({ action: "tool", tool: "calculator", arguments: {} }), question: "q",
      auth: { userId: "u", tenantId: "t", permissions: new Set() }, sources: [] });
    expect(none).toEqual([]);
  });
});

describe("answerChat with tools and stage events", () => {
  beforeEach(() => {
    for (const k of PROVIDER_KEYS) delete process.env[k];
    health.reset();
    process.env.GROQ_API_KEY = "g";
  });
  afterEach(() => { vi.unstubAllGlobals(); for (const k of PROVIDER_KEYS) delete process.env[k]; });

  it("feeds calculator results into the answer prompt and emits stages in order", async () => {
    const bodies: string[] = [];
    const replies = [
      JSON.stringify({ action: "tool", tool: "calculator", arguments: { operation: "multiply", a: 1234, b: 56 } }),
      JSON.stringify({ action: "done" }),
      "1234 × 56 = 69,104.",
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => { bodies.push(String(init?.body)); return chatReply(replies.shift()!); }));
    const events: string[] = [];
    const { answer, meta } = await answerChat({ mode: "chat", model: "auto", messages: [{ role: "user", content: "What is 1234 * 56?" }] }, local(), fetch,
      { onEvent: e => events.push(e.type === "status" ? e.stage : `${e.name}:${e.status}`) });
    expect(answer).toBe("1234 × 56 = 69,104.");
    expect(meta.tools).toEqual([{ tool: "calculator", ok: true }]);
    expect(bodies[2]).toContain('calculator → {\\"operation\\":\\"multiply\\",\\"value\\":69104}');
    expect(events).toEqual(["preprocess", "tools", "calculator:running", "calculator:complete", "generate", "validate", "deliver"]);
  });
});

describe("12 streaming client", () => {
  const sse = (...frames: string[]) => new Response(new ReadableStream({
    start(c) { for (const f of frames) c.enqueue(new TextEncoder().encode(f)); c.close(); },
  }), { headers: { "content-type": "text/event-stream" } });

  it("parses frames split across chunks and returns the final metadata", async () => {
    const seen: string[] = [];
    const out = await readChatResponse(sse(
      'event: status\ndata: {"stage":"generate"}\n\nevent: delta\ndata: {"text":"Hel',
      'lo "}\n\nevent: delta\ndata: {"text":"world"}\n\n',
      'event: final\ndata: {"pipeline":{"requestId":"r1"}}\n\n',
    ), e => seen.push(e.event));
    expect(out).toEqual({ ok: true, result: { data: { answer: "Hello world", pipeline: { requestId: "r1" } } } });
    expect(seen).toEqual(["status", "delta", "delta"]);
  });

  it("surfaces error events, plain JSON errors, and truncated streams", async () => {
    expect(await readChatResponse(sse('event: error\ndata: {"error":"AI_PROVIDER_UNAVAILABLE"}\n\n'), () => {}))
      .toEqual({ ok: false, result: { error: "AI_PROVIDER_UNAVAILABLE" } });
    expect(await readChatResponse(json({ error: "RATE_LIMITED" }, 429), () => {})).toEqual({ ok: false, result: { error: "RATE_LIMITED" } });
    await expect(readChatResponse(sse('event: delta\ndata: {"text":"cut"}\n\n'), () => {})).rejects.toThrow("ended early");
    expect(parseFrame("event: delta\ndata: not-json")).toBeNull();
  });
});

describe("POST /api/chat/stream", () => {
  beforeEach(() => { for (const k of PROVIDER_KEYS) delete process.env[k]; health.reset(); process.env.GROQ_API_KEY = "g"; delete process.env.DATABASE_URL; });
  afterEach(() => { vi.unstubAllGlobals(); for (const k of PROVIDER_KEYS) delete process.env[k]; });

  const post = async (body: unknown) => {
    const { POST } = await import("@/app/api/chat/stream/route");
    return POST(new Request("http://localhost:3000/api/chat/stream", {
      method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body),
    }));
  };

  it("streams status, validated deltas and final metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chatReply("Streaming works.")));
    const res = await post({ mode: "chat", model: "auto", style: "concise", messages: [{ role: "user", content: "Hello" }] });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text.indexOf("event: status")).toBeLessThan(text.indexOf("event: delta"));
    const { ok, result } = await readChatResponse(new Response(text, { headers: { "content-type": "text/event-stream" } }), () => {});
    expect(ok).toBe(true);
    expect(result.data.answer).toBe("Streaming works.");
    expect(result.data.pipeline).toMatchObject({ style: "concise" });
    expect(result.data.pipeline).not.toHaveProperty("provider");
  });

  it("rejects invalid input as JSON before streaming, and streams provider failures as error events", async () => {
    expect((await post({ mode: "chat", messages: [] })).status).toBe(422);
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "quota" }, 429)));
    const text = await (await post({ mode: "chat", model: "auto", messages: [{ role: "user", content: "Hello" }] })).text();
    expect(text).toContain('event: error\ndata: {"error":"AI_PROVIDER_UNAVAILABLE"}');
    expect(text).not.toContain("event: delta");
  });
});

describe("07 tool loop resilience", () => {
  it("keeps earlier results when a later step is malformed, and tolerates extra keys", async () => {
    let n = 0;
    const adapter: ModelAdapter = { generate: async () => n++ === 0
      ? JSON.stringify({ action: "tool", tool: "calculator", reason: "multiply first", arguments: { operation: "multiply", a: 3, b: 4 } })
      : "Sure! The next step is to add." };
    const results = await runToolLoop({ adapter, question: "3*4+1", auth: guest().execution, sources: [] });
    expect(results).toEqual([{ tool: "calculator", ok: true, output: { operation: "multiply", value: 12 } }]);
    await expect(runToolLoop({ adapter: { generate: async () => "not json" }, question: "q", auth: guest().execution, sources: [] })).rejects.toThrow();
  });
});
