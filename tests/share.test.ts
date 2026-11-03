import { describe, it, expect } from "vitest";
import { decodeShare, encodeShare, toMarkdown, type SharedProject } from "@/lib/share";

const project: SharedProject = {
  v: 1,
  title: "Landing page",
  mode: "code",
  messages: [
    { role: "user", content: "Build it\n\nAttached file: notes.txt\nhello", display: "Build it\n[Attached: notes.txt]" },
    { role: "assistant", content: "```html\n<h1>Hi ✓</h1>\n```" },
  ],
  prompts: [{ title: "Hero", mode: "code", prompt: "Make a hero section" }],
  uploads: [{ name: "logo.svg", content: "<svg></svg>" }],
};

describe("share links", () => {
  it("round-trips a project through the URL fragment", async () => {
    const hash = await encodeShare(project);
    expect(hash.startsWith("#share=")).toBe(true);
    expect(hash).toMatch(/^#share=[A-Za-z0-9_-]+$/);
    expect(await decodeShare(hash)).toEqual(project);
  });

  it("rejects malformed or tampered links", async () => {
    expect(await decodeShare("#other")).toBeNull();
    expect(await decodeShare("#share=not-valid")).toBeNull();
    const bad = await encodeShare({ ...project, mode: "evil" as never });
    expect(await decodeShare(bad)).toBeNull();
  });

  it("drops invalid shared prompts but keeps the project", async () => {
    const hash = await encodeShare({ ...project, prompts: [{ title: 1, prompt: "x", mode: "chat" } as never, ...project.prompts] });
    expect((await decodeShare(hash))?.prompts).toEqual(project.prompts);
  });

  it("renders Markdown using display text", () => {
    expect(toMarkdown("T", project.messages)).toContain("Build it\n[Attached: notes.txt]");
  });

  it("accepts older links without uploads", async () => {
    const { uploads: _, ...legacy } = project;
    expect((await decodeShare(await encodeShare(legacy)))?.uploads).toEqual([]);
  });
});
