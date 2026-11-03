export type CodeBlock = { id: string; message: number; lang: string; code: string };

const FENCE = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g;
const PREVIEWABLE = new Set(["html", "htm", "svg", "xml"]);

export function extractCodeBlocks(messages: { role: string; content: string }[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  messages.forEach((m, message) => {
    if (m.role !== "assistant") return;
    for (const [, lang, code] of m.content.matchAll(FENCE)) {
      blocks.push({ id: `${message}-${blocks.length}`, message, lang: lang.toLowerCase(), code: code.replace(/\n$/, "") });
    }
  });
  return blocks;
}

export const isPreviewable = (block: CodeBlock) =>
  PREVIEWABLE.has(block.lang) || (!block.lang && /^\s*<(!doctype|html|svg|body|div)/i.test(block.code));

// Generated code runs in an opaque-origin sandbox. This policy also blocks
// network requests and form posts; https scripts, styles, fonts, and images stay allowed.
const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob:; connect-src 'none'; form-action 'none'";

export function buildPreview(block: CodeBlock, all: CodeBlock[]): string {
  const siblings = all.filter(b => b.message === block.message && b !== block);
  const css = siblings.filter(b => b.lang === "css").map(b => `<style>${b.code}</style>`).join("\n");
  const js = siblings.filter(b => ["js", "javascript"].includes(b.lang)).map(b => `<script>${b.code.replace(/<\/script/gi, "<\\/script")}<\/script>`).join("\n");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1">`;
  const head = `<head>${meta}${css}</head>`;
  if (/<html[\s>]/i.test(block.code)) {
    const withHead = /<head[\s>]/i.test(block.code)
      ? block.code.replace(/<head([^>]*)>/i, `<head$1>${meta}${css}`)
      : block.code.replace(/<html([^>]*)>/i, `<html$1>${head}`);
    return /<\/body>/i.test(withHead) ? withHead.replace(/<\/body>/i, `${js}</body>`) : withHead + js;
  }
  return `<!doctype html><html>${head}<body>${block.code}${js}</body></html>`;
}

export type CanvasItem =
  | { kind: "prompt"; title: string; mode: "chat" | "code" | "research"; prompt: string }
  | { kind: "upload"; name: string; content: string };

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const isMarkupFile = (name: string) => /\.(svg|html?)$/i.test(name);

// Prompts and text files are shown escaped; SVG/HTML uploads render live in the sandbox.
export function buildItemPreview(item: CanvasItem): string {
  if (item.kind === "upload" && isMarkupFile(item.name)) {
    const block = { id: "upload", message: -1, lang: /\.svg$/i.test(item.name) ? "svg" : "html", code: item.content };
    const doc = buildPreview(block, [block]);
    return /\.svg$/i.test(item.name)
      ? doc.replace("<body>", '<body style="margin:0;min-height:100vh;display:grid;place-items:center">')
      : doc;
  }
  const title = item.kind === "prompt" ? item.title : item.name;
  const body = item.kind === "prompt" ? item.prompt : item.content;
  const label = item.kind === "prompt" ? `Prompt · ${item.mode}` : "Uploaded file";
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"></head>` +
    `<body style="font-family:system-ui,sans-serif;padding:24px;color:#1e293b">` +
    `<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8">${escapeHtml(label)}</div>` +
    `<h2 style="margin:6px 0 16px;font-weight:600">${escapeHtml(title)}</h2>` +
    `<pre style="white-space:pre-wrap;font:13px/1.6 ui-monospace,monospace;background:#f1f5f9;padding:16px;border-radius:8px">${escapeHtml(body)}</pre></body></html>`;
}
