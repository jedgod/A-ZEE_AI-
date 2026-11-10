import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/db", () => ({ pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }, transaction: vi.fn() }));
vi.mock("@/15_EXTENSIONS/hooks", () => ({ runHooks: vi.fn(async () => ({})) }));
const plan = vi.hoisted(() => ({ id: "free" as string }));
vi.mock("@/lib/plans", async importOriginal => ({
  ...await importOriginal<object>(),
  accessFor: vi.fn(async () => ({ planId: plan.id, planName: plan.id === "free" ? "Free" : "Plus", subject: { key: "account:u1", accountId: "u1" }, entitlements: {} })),
  can: vi.fn(() => false),
  reserveUsage: vi.fn(async () => ({ refund: async () => {} })),
}));
vi.mock("@/lib/accounts", () => ({ accountById: vi.fn(async () => ({ id: "u1" })), personalizationFor: vi.fn(async () => "Always give very detailed, complete answers.") }));
vi.mock("@/lib/sidebar", () => ({ projectInstructions: vi.fn(async () => null) }));

import { answerChat } from "@/lib/pipeline";
import { webActor } from "@/lib/pipeline/actor";
import { closeOpenFences, FREE_CODE_DEFAULT_TOKENS, FREE_CODE_NOTICE, freeCodeBudget, freeCodeLimitApplies, isCodeRequest, looksLikeCodeRequest } from "@/lib/pipeline/free-limits";
import { health } from "@/lib/pipeline/registry";

const KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "MISTRALAI_API_KEY", "OPENROUTERAI_API_KEY", "TOGETHERAI_API_KEY"];
const user = () => webActor(new Request("http://localhost:3000/api/chat"), { id: "u1", name: "Ada", email: "ada@example.com", verified: true }).actor;
const ask = (mode: "chat" | "code", content: string) => answerChat({ mode, model: "auto", messages: [{ role: "user", content }] }, user());

describe("free-plan code limits (unit)", () => {
  it("applies only to Free accounts asking for code", () => {
    expect(freeCodeLimitApplies({ planId: "free" }, "code", "code")).toBe(true);
    expect(freeCodeLimitApplies({ planId: "free" }, "chat", "code")).toBe(true);      // code asked for in the chat mode
    expect(freeCodeLimitApplies({ planId: "free" }, "chat", "qa")).toBe(false);
    expect(freeCodeLimitApplies({ planId: "plus" }, "code", "code")).toBe(false);
    expect(freeCodeLimitApplies({ planId: "pro25" }, "code", "code")).toBe(false);
    expect(freeCodeLimitApplies(null, "code", "code")).toBe(false);                    // unknown access is never limited
    expect(isCodeRequest("code", "qa")).toBe(true);
  });

  it("spots requests for code in any mode, without catching ordinary questions", () => {
    for (const text of [
      "Write a python function that sorts a list", "Build me a todo list app with React", "create a website for my bakery", "how do I implement a REST api in express?",
      "Here is my code:\n```js\nconst a = 1\n```\nwhy does it fail?", "can you debug this", "Show me the code for a login page in html", "generate a SQL query to find duplicates",
      "I need a chatbot built with node.js", "refactor this", "write me a script to rename files",
    ]) expect(looksLikeCodeRequest(text), text).toBe(true);
    for (const text of [
      "What is the capital of France?", "Summarise this article for me", "Explain photosynthesis simply", "Write a poem about the sea", "Give me a recipe for pancakes",
      "How do I code-switch between languages when I speak?", "What's a good name for my bakery?", "Translate this to Spanish",
    ]) expect(looksLikeCodeRequest(text), text).toBe(false);
  });

  it("has a small default budget that an operator can tune within safe bounds", () => {
    expect(freeCodeBudget({})).toBe(FREE_CODE_DEFAULT_TOKENS);
    expect(freeCodeBudget({ AZ_FREE_CODE_MAX_TOKENS: "300" })).toBe(300);
    expect(freeCodeBudget({ AZ_FREE_CODE_MAX_TOKENS: "999999" })).toBe(1000);
    expect(freeCodeBudget({ AZ_FREE_CODE_MAX_TOKENS: "5" })).toBe(100);
    expect(freeCodeBudget({ AZ_FREE_CODE_MAX_TOKENS: "abc" })).toBe(FREE_CODE_DEFAULT_TOKENS);
  });

  it("closes a code block the budget cut off, and leaves complete answers alone", () => {
    expect(closeOpenFences("Here:\n```js\nconst a = 1;")).toBe("Here:\n```js\nconst a = 1;\n```\n");
    const complete = "Here:\n```js\nconst a = 1;\n```\nDone.";
    expect(closeOpenFences(complete)).toBe(complete);
    expect(closeOpenFences("No code here.")).toBe("No code here.");
  });
});

describe("free-plan code limits (through the pipeline)", () => {
  let requests: { max_tokens?: number; messages: { role: string; content: string }[] }[];
  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
    process.env.GROQ_API_KEY = "g"; process.env.DATABASE_URL = "postgres://test"; delete process.env.AZ_FREE_CODE_MAX_TOKENS;
    health.reset(); plan.id = "free"; requests = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: "```py\nprint('hi')" } }] }), { headers: { "content-type": "application/json" } });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.DATABASE_URL; for (const k of KEYS) delete process.env[k]; });

  const sent = () => requests.at(-1)!;
  const system = () => sent().messages[0].content;
  const budget = () => (sent() as { max_tokens?: number; max_completion_tokens?: number }).max_tokens ?? (sent() as { max_completion_tokens?: number }).max_completion_tokens;

  it("caps a free code answer's length, tells the model to keep it basic, and says so to the user", async () => {
    const result = await ask("code", "Build me a todo list app with React and a database");
    expect(budget()).toBe(FREE_CODE_DEFAULT_TOKENS);
    expect(system()).toContain("The user is on the Free plan");
    expect(system()).toContain("at most about 20 lines of code");
    expect(system().lastIndexOf("The user is on the Free plan")).toBeGreaterThan(system().indexOf("Always give very detailed")); // the limit comes after personal instructions
    expect(result.meta.warnings).toContain(FREE_CODE_NOTICE);
    expect(result.answer.match(/```/g)?.length).toBe(2);                                // the cut-off block was closed
  });

  it("also limits code asked for in the chat mode", async () => {
    await ask("chat", "Write a python function that sorts a list of numbers");
    expect(system()).toContain("The user is on the Free plan");
    expect(budget()).toBe(FREE_CODE_DEFAULT_TOKENS);
  });

  it("leaves ordinary free chat alone", async () => {
    const result = await ask("chat", "What is the capital of France?");
    expect(system()).not.toContain("The user is on the Free plan");
    expect(budget()).not.toBe(FREE_CODE_DEFAULT_TOKENS);
    expect(result.meta.warnings).not.toContain(FREE_CODE_NOTICE);
  });

  it("never limits paid plans", async () => {
    plan.id = "plus";
    const result = await ask("code", "Build me a todo list app with React and a database");
    expect(system()).not.toContain("The user is on the Free plan");
    expect(budget()).not.toBe(FREE_CODE_DEFAULT_TOKENS);
    expect(result.meta.warnings).not.toContain(FREE_CODE_NOTICE);
  });
});
