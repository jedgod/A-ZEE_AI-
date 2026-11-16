import { Fragment, type ReactNode } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
const SOFT = "rgba(128,128,128,0.16)";      // code and table backgrounds: neutral overlays so they work on the black chat and on light screens
const EDGE = "rgba(128,128,128,0.38)";
const MUTED = 0.72;

type Block =
  | { k: "code"; text: string }
  | { k: "h"; level: number; text: string }
  | { k: "p"; text: string }
  | { k: "ul" | "ol"; items: { text: string; n?: string }[] }
  | { k: "quote"; text: string }
  | { k: "table"; head: string[]; rows: string[][] }
  | { k: "hr" };

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
const isSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");

/** Markdown (the same kind the website shows) turned into blocks. Exported for tests. */
export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ k: "p", text: para.join(" ").trim() }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      out.push({ k: "code", text: code.join("\n") });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push({ k: "h", level: h[1].length, text: h[2].replace(/\s*#+\s*$/, "") }); continue; }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { flush(); out.push({ k: "hr" }); continue; }
    if (line.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      flush();
      const head = cells(line); const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) rows.push(cells(lines[i]));
      i--;
      out.push({ k: "table", head, rows });
      continue;
    }
    const li = /^\s*([-*•])\s+(.*)$/.exec(line), num = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (li || num) {
      flush();
      const kind = li ? "ul" : "ol";
      const items: { text: string; n?: string }[] = [];
      for (; i < lines.length; i++) {
        const a = /^\s*([-*•])\s+(.*)$/.exec(lines[i]), b = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(lines[i]);
        if (kind === "ul" && a) items.push({ text: a[2] });
        else if (kind === "ol" && b) items.push({ text: b[2], n: b[1] });
        else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1].text += ` ${lines[i].trim()}`;
        else break;
      }
      i--;
      out.push({ k: kind, items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const q: string[] = [];
      for (; i < lines.length && /^\s*>\s?/.test(lines[i]); i++) q.push(lines[i].replace(/^\s*>\s?/, ""));
      i--;
      out.push({ k: "quote", text: q.join(" ").trim() });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

/** **bold**, *italic*, `code` and [links](https://…) inside one line of text. */
function inline(text: string, color: string, size: number, key = "i"): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0, n = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(<Fragment key={`${key}t${n++}`}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) nodes.push(<Text key={`${key}b${n++}`} style={{ fontWeight: "700" }}>{inline(tok.slice(2, -2), color, size, `${key}b${n}`)}</Text>);
    else if (tok.startsWith("`")) nodes.push(<Text key={`${key}c${n++}`} style={{ fontFamily: MONO, fontSize: size - 2, backgroundColor: SOFT }}>{` ${tok.slice(1, -1)} `}</Text>);
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok)!;
      nodes.push(<Text key={`${key}l${n++}`} accessibilityRole="link" onPress={() => void Linking.openURL(lm[2])} style={{ color: "#4da3ff", textDecorationLine: "underline" }}>{lm[1]}</Text>);
    } else nodes.push(<Text key={`${key}e${n++}`} style={{ fontStyle: "italic" }}>{tok.slice(1, -1)}</Text>);
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(<Fragment key={`${key}t${n++}`}>{text.slice(last)}</Fragment>);
  return nodes;
}

/**
 * An answer laid out like the website: headings, bold and italics, bullet and numbered lists, tables, quotes, links and code boxes.
 * Text is selectable so people can copy it. Plain text with none of this renders as ordinary paragraphs.
 */
export function MessageText({ text, color, plain }: { text: string; color: string; plain?: boolean }) {
  // Your own messages are shown exactly as typed; only answers are formatted.
  if (plain) return <Text selectable style={{ color, fontSize: 16, lineHeight: 23 }}>{text}</Text>;
  const blocks = parseBlocks(text);
  const size = 16;
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((b, i) => {
        switch (b.k) {
          case "code":
            return (
              <ScrollView key={i} horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: SOFT, borderColor: EDGE, borderWidth: 1, borderRadius: 10 }} contentContainerStyle={{ padding: 10 }}>
                <Text selectable style={{ color, fontFamily: MONO, fontSize: 13, lineHeight: 19 }}>{b.text}</Text>
              </ScrollView>
            );
          case "h":
            return <Text key={i} selectable accessibilityRole="header" style={{ color, fontWeight: "700", fontSize: b.level <= 1 ? 22 : b.level === 2 ? 19 : 17, lineHeight: b.level <= 1 ? 28 : 25, marginTop: i === 0 ? 0 : 6 }}>{inline(b.text, color, size, `h${i}`)}</Text>;
          case "p":
            return <Text key={i} selectable style={{ color, fontSize: size, lineHeight: 24 }}>{inline(b.text, color, size, `p${i}`)}</Text>;
          case "ul":
          case "ol":
            return (
              <View key={i} style={{ gap: 6 }}>
                {b.items.map((it, n) => (
                  <View key={n} style={{ flexDirection: "row", gap: 8 }}>
                    <Text style={{ color, opacity: MUTED, fontSize: size, lineHeight: 24, minWidth: 18, textAlign: "right" }}>{b.k === "ol" ? `${it.n ?? n + 1}.` : "•"}</Text>
                    <Text selectable style={{ color, fontSize: size, lineHeight: 24, flex: 1 }}>{inline(it.text, color, size, `l${i}-${n}`)}</Text>
                  </View>
                ))}
              </View>
            );
          case "quote":
            return (
              <View key={i} style={{ borderLeftWidth: 3, borderLeftColor: EDGE, paddingLeft: 12 }}>
                <Text selectable style={{ color, opacity: MUTED, fontSize: size, lineHeight: 24, fontStyle: "italic" }}>{inline(b.text, color, size, `q${i}`)}</Text>
              </View>
            );
          case "hr":
            return <View key={i} style={{ height: 1, backgroundColor: EDGE, marginVertical: 4 }} />;
          case "table": {
            const cols = Math.max(b.head.length, ...b.rows.map(r => r.length));
            const minW = cols <= 3 ? undefined : 120;
            const cell = (txt: string, c: number, head: boolean, last: boolean) => (
              <View key={c} style={{ flex: minW ? undefined : 1, width: minW, paddingHorizontal: 10, paddingVertical: 8, borderRightWidth: last ? 0 : 1, borderRightColor: EDGE }}>
                <Text selectable style={{ color, fontSize: 14, lineHeight: 20, fontWeight: head ? "700" : "400" }}>{inline(txt, color, 14, `t${i}-${c}`)}</Text>
              </View>
            );
            const row = (r: string[], head: boolean, n: number) => (
              <View key={n} style={{ flexDirection: "row", backgroundColor: head ? SOFT : "transparent", borderTopWidth: head ? 0 : 1, borderTopColor: EDGE }}>
                {Array.from({ length: cols }, (_, c) => cell(r[c] ?? "", c, head, c === cols - 1))}
              </View>
            );
            const grid = <View style={{ borderWidth: 1, borderColor: EDGE, borderRadius: 10, overflow: "hidden", minWidth: minW ? minW * cols : undefined }}>{row(b.head, true, -1)}{b.rows.map((r, n) => row(r, false, n))}</View>;
            return minW ? <ScrollView key={i} horizontal showsHorizontalScrollIndicator={false}>{grid}</ScrollView> : <View key={i}>{grid}</View>;
          }
        }
      })}
    </View>
  );
}
