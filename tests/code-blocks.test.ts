import { describe, it, expect } from "vitest";
import { buildItemPreview, buildPreview, extractCodeBlocks, isMarkupFile, isPreviewable } from "@/lib/code-blocks";

const messages = [
  { role: "user", content: "```html\n<p>ignored user code</p>\n```" },
  { role: "assistant", content: "Here:\n\n```html\n<button>Go</button>\n```\n\n```css\nbutton { color: red; }\n```\n\n```js\nconsole.log('</script>')\n```" },
  { role: "assistant", content: "```python\nprint(1)\n```\n\n```\n<svg width=\"10\"></svg>\n```" },
];

describe("code blocks", () => {
  const blocks = extractCodeBlocks(messages);

  it("extracts fenced blocks from assistant messages only", () => {
    expect(blocks.map(b => b.lang)).toEqual(["html", "css", "js", "python", ""]);
    expect(blocks[0].code).toBe("<button>Go</button>");
  });

  it("detects previewable blocks, including unlabeled markup", () => {
    expect(blocks.filter(isPreviewable).map(b => b.lang)).toEqual(["html", ""]);
  });

  it("bundles same-message CSS and JS with a locked-down CSP", () => {
    const doc = buildPreview(blocks[0], blocks);
    expect(doc).toContain("<style>button { color: red; }</style>");
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("<\\/script");
    expect(doc.match(/<\/script>/g)).toHaveLength(1);
  });

  it("injects the policy into full documents", () => {
    const [full] = extractCodeBlocks([{ role: "assistant", content: "```html\n<html><head><title>x</title></head><body>hi</body></html>\n```" }]);
    expect(buildPreview(full, [full])).toMatch(/<head><meta http-equiv="Content-Security-Policy"/);
  });
});

describe("canvas item previews", () => {
  it("escapes prompt and text-file content", () => {
    const doc = buildItemPreview({ kind: "prompt", title: "<b>x</b>", mode: "code", prompt: "<img src=x onerror=alert(1)>" });
    expect(doc).not.toContain("<img");
    expect(doc).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(buildItemPreview({ kind: "upload", name: "a.md", content: "<script>1</script>" })).toContain("&lt;script&gt;");
  });

  it("renders SVG and HTML uploads live under the preview policy", () => {
    const svg = buildItemPreview({ kind: "upload", name: "logo.svg", content: "<svg viewBox='0 0 10 10'></svg>" });
    expect(svg).toContain("<svg viewBox='0 0 10 10'></svg>");
    expect(svg).toContain("connect-src 'none'");
    expect(isMarkupFile("page.HTML")).toBe(true);
    expect(isMarkupFile("notes.txt")).toBe(false);
  });
});
