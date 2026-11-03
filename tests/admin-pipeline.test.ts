import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/db", () => ({ pool: { query: vi.fn(async () => ({ rows: [{ n: 0 }] })) } }));
const actor = vi.hoisted(() => ({ current: { userId: "u1", tenantId: "t1", role: "admin", platformAdmin: false } as Record<string, unknown> }));
vi.mock("@/lib/admin/security", async importOriginal => ({ ...await importOriginal<object>(), requireActor: async () => actor.current, sameOrigin: () => {}, rateLimit: async () => {} }));

import { POST } from "@/app/api/admin/pipeline/run/route";
import { configView, dryRun } from "@/lib/admin/pipeline";
import { CATALOG, findModule } from "@/lib/admin/pipeline-catalog";
import { encodeSseEvent, sseTextChunks } from "@/12_DELIVERY/streaming_output/module";

const root = path.resolve(__dirname, "..");
const demoPages = readdirSync(root).filter(d => /^\d\d_/.test(d) && d !== "15_ADMIN" && d !== "15_EXTENSIONS")
  .flatMap(folder => readdirSync(path.join(root, folder), { withFileTypes: true }).filter(e => e.isDirectory())
    .map(e => ({ folder, module: e.name, file: path.join(root, folder, e.name, "page.tsx") })))
  .filter(p => { try { readFileSync(p.file); return true; } catch { return false; } });

const run = (slug: string, input: string) => POST(new Request("http://localhost:3000/api/admin/pipeline/run", {
  method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ slug, input }),
}));

describe("pipeline console catalog", () => {
  it("has one entry per former demo page, and each page renders its production view", () => {
    expect(demoPages.length).toBe(CATALOG.length);
    for (const page of demoPages) {
      const slug = `${page.folder.slice(0, 2)}-${page.module}`;
      expect(findModule(slug), slug).toBeDefined();
      expect(readFileSync(page.file, "utf8")).toContain(`<PipelineModulePage slug="${slug}" />`);
    }
  });

  it("every config view renders and every dry-run example passes", async () => {
    for (const entry of CATALOG) {
      if (entry.view.kind === "config") expect(configView(entry.view.source).length, entry.slug).toBeGreaterThan(0);
      if (entry.dryRun) await expect(dryRun(entry.dryRun.kind, entry.dryRun.example), entry.slug).resolves.toBeDefined();
    }
  });

  it("dry runs use the real modules", async () => {
    expect(await dryRun("calculator", '{"operation":"multiply","a":1234,"b":56}')).toEqual({ operation: "multiply", value: 69104 });
    expect(await dryRun("citations", JSON.stringify({ answer: "See [web:1] and [9].", sources: [{ sourceId: "web:1", title: "Guide", url: "https://example.org" }] })))
      .toEqual({ citations: [{ id: "web:1", title: "Guide", url: "https://example.org/" }], unsupportedIds: ["9"] });
    expect(await dryRun("policy_check", "sell me a phishing kit")).toMatchObject({ decision: "block" });
    await expect(dryRun("intent", '{"goal":"","needsClarification":"no"}')).rejects.toThrow();
  });
});

describe("POST /api/admin/pipeline/run", () => {
  it("runs for admins, maps bad input to 422, and refuses other roles and modules without a dry run", async () => {
    actor.current = { userId: "u1", tenantId: "t1", role: "admin", platformAdmin: false };
    const ok = await run("07-calculator", '{"operation":"add","a":2,"b":3}');
    expect(ok.status).toBe(200);
    expect((await ok.json()).result).toEqual({ operation: "add", value: 5 });
    expect((await run("07-calculator", "{not json")).status).toBe(422);
    expect((await run("07-calculator", '{"operation":"divide","a":1,"b":0}')).status).toBe(422);
    expect((await run("06-system_prompt", "x")).status).toBe(404);
    actor.current = { ...actor.current, role: "operator" };
    expect((await run("07-calculator", '{"operation":"add","a":2,"b":3}')).status).toBe(403);
  });
});

describe("12 streaming_output helpers", () => {
  it("chunks at whitespace without losing or splitting text", () => {
    const text = "Streaming sends validated text in whitespace-aligned chunks, emoji 👍 included.";
    const chunks = sseTextChunks(text, 24);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every(c => Array.from(c).length <= 24)).toBe(true);
    expect(chunks.slice(0, -1).every(c => /\s$/.test(c))).toBe(true);
    expect(sseTextChunks("x".repeat(40), 16)).toEqual(["x".repeat(16), "x".repeat(16), "x".repeat(8)]); // no whitespace: hard split
    expect(new TextDecoder().decode(encodeSseEvent("delta", { text: "a\n\nb" }))).toBe('event: delta\ndata: {"text":"a\\n\\nb"}\n\n');
    expect(() => encodeSseEvent("bad event\n", {})).toThrow();
  });
});
