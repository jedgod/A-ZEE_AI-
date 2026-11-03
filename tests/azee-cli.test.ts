import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  buildMessage, CliError, configPath, EXIT, languageFor, parseArgs, run, selectLines, validateBase,
} from "../azee-connect/cli/azee.mjs";

const TOKEN = "az_" + "a".repeat(64);
const SOURCE = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

function harness(reply: { status?: number; body: unknown }) {
  const dir = mkdtempSync(join(tmpdir(), "azee-"));
  const calls: { url: string; init: RequestInit }[] = [];
  let out = "";
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  const io = (stdin: Readable & { isTTY?: boolean } = Object.assign(Readable.from([]), { isTTY: true })) => ({
    stdout: { write: (t: string) => { out += t; } },
    stdin,
    env: { APPDATA: dir, XDG_CONFIG_HOME: dir, AZEE_URL: "http://localhost:3000", AZEE_TOKEN: TOKEN },
    fetchImpl,
  });
  return { dir, calls, io, output: () => out };
}

describe("azee CLI helpers", () => {
  it("parses commands, flags and inline values", () => {
    const a = parseArgs(["explain", "main.cpp", "--lines=10-20", "--mode", "chat"]);
    expect(a).toEqual({ command: "explain", positional: ["main.cpp"], flags: { lines: "10-20", mode: "chat" } });
    expect(() => parseArgs(["ask", "--mode", "fast"])).toThrow(CliError);
    expect(() => parseArgs(["ask", "--nope"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["explain", "--lines", "1-2", "--around", "4"])).toThrow(/only one/);
  });

  it("selects line ranges and cursor windows", () => {
    expect(selectLines(SOURCE, { lines: "3-5" })).toEqual({ code: "line 3\nline 4\nline 5", start: 3, end: 5, total: 100 });
    expect(selectLines(SOURCE, { around: "10" })).toMatchObject({ start: 1, end: 50 });
    expect(selectLines(SOURCE, { around: "95" })).toMatchObject({ start: 55, end: 100 });
    expect(selectLines("a\r\nb\r\n").code).toBe("a\nb");
    expect(() => selectLines(SOURCE, { lines: "200-210" })).toThrow(/only 100 lines/);
    expect(() => selectLines(SOURCE, { lines: "9-3" })).toThrow(CliError);
  });

  it("builds a fenced message with file context", () => {
    const msg = buildMessage({ task: "review", code: "int x;", file: "src/a.c", start: 3, end: 3, total: 9, lang: "c" });
    expect(msg).toContain("Review this code");
    expect(msg).toContain("File: a.c (lines 3-3 of 9)");
    expect(msg).toContain("```c\nint x;\n```");
    expect(buildMessage({ question: "Why?", code: "x ``` y" })).toContain("````\nx ``` y\n````");
    expect(buildMessage({ question: "Hi" })).toBe("Hi");
  });

  it("guesses languages and validates server URLs", () => {
    expect(languageFor("Main.CPP")).toBe("cpp");
    expect(languageFor("project.cbp")).toBe("xml");
    expect(languageFor()).toBe("");
    expect(validateBase("https://az.example.com")).toBe(true);
    expect(validateBase("http://localhost:3000")).toBe(true);
    expect(validateBase("http://192.168.1.4:3000")).toBe(false);
    expect(validateBase("https://user:pw@az.example.com")).toBe(false);
    expect(configPath({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "win32")).toMatch(/azee[\\/]config\.json$/);
  });
});

describe("azee CLI commands", () => {
  it("explains a file slice and sends it in code mode", async () => {
    const h = harness({ body: { data: { answer: "## It counts" } } });
    const file = join(h.dir, "main.cpp");
    writeFileSync(file, SOURCE);
    const out = join(h.dir, "answer.md");
    expect(await run(["explain", file, "--lines", "2-3", "--out", out], h.io())).toBe(EXIT.OK);
    expect(h.output()).toBe("## It counts\n");
    expect(readFileSync(out, "utf8")).toBe("## It counts\n");
    expect(h.calls[0].url).toBe("http://localhost:3000/api/v1/chat");
    expect((h.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(h.calls[0].init.body));
    expect(body.mode).toBe("code");
    expect(body.messages[0].content).toContain("File: main.cpp (lines 2-3 of 100)\n\n```cpp\nline 2\nline 3\n```");
  });

  it("reads piped selections for ask", async () => {
    const h = harness({ body: { data: { answer: "Use a map." } } });
    // Real pipes report isTTY as undefined, not false.
    const stdin = Object.assign(Readable.from([Buffer.from("for i in x: pass")]), { isTTY: undefined });
    await run(["ask", "How can I speed this up?"], h.io(stdin));
    const body = JSON.parse(String(h.calls[0].init.body));
    expect(body.mode).toBe("chat");
    expect(body.messages[0].content).toMatch(/^How can I speed this up\?\n\nCode from editor selection\n\n```\nfor i in x: pass\n```$/);
  });

  it("doesn't hang when an IDE leaves stdin open but silent", async () => {
    const h = harness({ body: { data: { answer: "ok" } } });
    const silent = Object.assign(new Readable({ read() {} }), { isTTY: undefined });
    await run(["ask", "General question"], { ...h.io(silent), stdinWaitMs: 50 });
    expect(JSON.parse(String(h.calls[0].init.body)).messages[0].content).toBe("General question");
    const empty = harness({ body: {} });
    await expect(run(["explain"], { ...empty.io(Object.assign(new Readable({ read() {} }), { isTTY: undefined })), stdinWaitMs: 50 }))
      .rejects.toThrow(/Give a file/);
  });

  it("refuses oversized input before calling the server", async () => {
    const h = harness({ body: {} });
    const file = join(h.dir, "big.txt");
    writeFileSync(file, "x".repeat(25000));
    await expect(run(["review", file], h.io())).rejects.toThrow(/limit is 20,000/);
    expect(h.calls).toHaveLength(0);
  });

  it("maps server errors to friendly messages and exit codes", async () => {
    const h = harness({ status: 401, body: { error: "INVALID_TOKEN" } });
    await expect(run(["status"], h.io())).rejects.toMatchObject({ code: EXIT.AUTH, message: expect.stringMatching(/connect:token/) });
    const r = harness({ status: 429, body: { error: "RATE_LIMITED" } });
    await expect(run(["ask", "hi"], r.io())).rejects.toMatchObject({ code: EXIT.REQUEST });
  });

  it("verifies the token before saving configuration", async () => {
    const h = harness({ body: { data: { expiresAt: "2026-12-01T00:00:00.000Z" } } });
    await run(["configure", "--url", "http://localhost:3000/", "--token", TOKEN], h.io());
    expect(h.calls[0].url).toBe("http://localhost:3000/api/v1/status");
    const saved = JSON.parse(readFileSync(configPath({ APPDATA: h.dir, XDG_CONFIG_HOME: h.dir }), "utf8"));
    expect(saved).toEqual({ url: "http://localhost:3000", token: TOKEN });
    expect(h.output()).toContain("valid until 2026-12-01");

    const bad = harness({ status: 401, body: { error: "INVALID_TOKEN" } });
    await expect(run(["configure", "--token", TOKEN], bad.io())).rejects.toMatchObject({ code: EXIT.AUTH });
  });
});
