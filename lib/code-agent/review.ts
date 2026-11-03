import { createHash } from "node:crypto";
import { CodeAgentError } from "./paths";

// Pure patch logic: applying the model's edits in memory, unified diffs, the patch hash that
// approval is bound to, and the risk review shown before anything is written.

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export type Edit = { find: string; replace: string };
export type ChangeSpec =
  | { path: string; action: "modify"; edits: Edit[] }
  | { path: string; action: "create"; content: string }
  | { path: string; action: "delete" };

const count = (hay: string, needle: string) => { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; } return n; };

/** Each edit's `find` must occur exactly once in the current text (CRLF files accept LF edits). */
export function applyEdits(original: string, edits: Edit[], file: string): string {
  const crlf = original.includes("\r\n");
  let text = original;
  edits.forEach((edit, i) => {
    let { find, replace } = edit;
    if (!find) throw new CodeAgentError(422, "EDIT_EMPTY", { file, edit: i });
    if (crlf && count(text, find) === 0 && !find.includes("\r\n")) { find = find.replace(/\n/g, "\r\n"); replace = replace.replace(/\r?\n/g, "\r\n"); }
    const n = count(text, find);
    if (n === 0) throw new CodeAgentError(422, "EDIT_NOT_FOUND", { file, edit: i });
    if (n > 1) throw new CodeAgentError(422, "EDIT_AMBIGUOUS", { file, edit: i, matches: n });
    const at = text.indexOf(find);
    text = text.slice(0, at) + replace + text.slice(at + find.length);
  });
  if (text === original) throw new CodeAgentError(422, "EDIT_NO_CHANGE", { file });
  return text;
}

type Op = { kind: " " | "-" | "+"; line: string };

/** Myers O((N+M)·D) line diff. */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length, max = n + m;
  const v = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0)) ? v.get(k + 1) ?? 0 : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= n && y >= m) break outer;
    }
  }
  const ops: Op[] = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d], k = x - y;
    const prevK = k === -d || (k !== d && (vd.get(k - 1) ?? 0) < (vd.get(k + 1) ?? 0)) ? k + 1 : k - 1;
    const prevX = vd.get(prevK) ?? 0, prevY = prevX - prevK;
    while (x > prevX && y > prevY) ops.push({ kind: " ", line: a[--x] }), y--;
    if (d > 0) { if (x === prevX) ops.push({ kind: "+", line: b[--y] }); else ops.push({ kind: "-", line: a[--x] }); }
  }
  return ops.reverse();
}

const splitLines = (text: string | null) => (text === null || text === "" ? [] : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n"));

/** Unified diff (3 lines of context) with addition/deletion counts. */
export function unifiedDiff(file: string, before: string | null, after: string | null) {
  const ops = diffLines(splitLines(before), splitLines(after));
  const additions = ops.filter(o => o.kind === "+").length, deletions = ops.filter(o => o.kind === "-").length;
  const out = [`--- ${before === null ? "/dev/null" : `a/${file}`}`, `+++ ${after === null ? "/dev/null" : `b/${file}`}`];
  const CONTEXT = 3;
  let i = 0;
  const aLine = (idx: number) => ops.slice(0, idx).filter(o => o.kind !== "+").length;
  const bLine = (idx: number) => ops.slice(0, idx).filter(o => o.kind !== "-").length;
  while (i < ops.length) {
    if (ops[i].kind === " ") { i++; continue; }
    let start = Math.max(0, i - CONTEXT), end = i;
    // Extend the hunk while changes are within 2×context of each other.
    for (;;) {
      while (end < ops.length && ops[end].kind !== " ") end++;
      let next = end;
      while (next < ops.length && ops[next].kind === " " && next - end < CONTEXT * 2) next++;
      if (next < ops.length && ops[next].kind !== " ") { end = next; continue; }
      end = Math.min(ops.length, end + CONTEXT);
      break;
    }
    const hunk = ops.slice(start, end);
    const aCount = hunk.filter(o => o.kind !== "+").length, bCount = hunk.filter(o => o.kind !== "-").length;
    out.push(`@@ -${aLine(start) + (aCount ? 1 : 0)},${aCount} +${bLine(start) + (bCount ? 1 : 0)},${bCount} @@`);
    for (const o of hunk) out.push(o.kind + o.line);
    i = end;
  }
  return { diff: out.join("\n"), additions, deletions };
}

export type PreparedChange = {
  path: string; action: "create" | "modify" | "delete";
  baseHash: string | null; baseContent: string | null;
  newHash: string | null; newContent: string | null;
  diff: string; additions: number; deletions: number;
};

/** The hash approval is bound to: every file, its action, what it must contain now and afterwards. */
export const patchHash = (changes: Pick<PreparedChange, "path" | "action" | "baseHash" | "newHash">[]) =>
  sha256(JSON.stringify(changes.map(c => [c.path, c.action, c.baseHash, c.newHash])));

export type Warning = { severity: "block" | "high" | "medium"; code: string; path: string; message: string };

const SECRETS: [string, RegExp][] = [
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["API secret key", /\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Private key", /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/],
  ["Hard-coded credential", /\b(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/i],
];

/** Secrets in added lines only (a secret that was already there isn't introduced by the agent). */
export function scanSecrets(diff: string): string[] {
  const added = diff.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++")).join("\n");
  return SECRETS.filter(([, re]) => re.test(added)).map(([name]) => name);
}

const RULES: [Warning["severity"], string, RegExp, string][] = [
  ["high", "DEPENDENCY_CHANGE", /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|go\.(mod|sum)|Cargo\.(toml|lock)|Gemfile(\.lock)?)$/i, "Changes dependencies: review new packages and versions."],
  ["high", "CI_OR_DEPLOY", /(^|\/)(\.github\/workflows\/|\.gitlab-ci|Dockerfile|docker-compose|azure-pipelines|Jenkinsfile|vercel\.json|netlify\.toml)/i, "Changes CI, container or deployment configuration."],
  ["high", "DATABASE_MIGRATION", /(^|\/)migrations?\/|\.sql$/i, "Changes the database schema or data."],
  ["medium", "SECURITY_SENSITIVE", /(auth|security|crypto|session|permission|password|token|middleware)/i, "Touches authentication, authorization or security code."],
  ["medium", "EXECUTABLE_SCRIPT", /(\.(sh|ps1|bat|cmd)$|(^|\/)scripts\/)/i, "Changes a script that can be executed."],
];

export function reviewChanges(changes: PreparedChange[]): Warning[] {
  const warnings: Warning[] = [];
  for (const c of changes) {
    const found = scanSecrets(c.diff);
    if (found.length) warnings.push({ severity: "block", code: "SECRET_DETECTED", path: c.path, message: `Adds what looks like a secret (${found.join(", ")}). Secrets can't be approved.` });
    for (const [severity, code, re, message] of RULES) if (re.test(c.path)) warnings.push({ severity, code, path: c.path, message });
    if (c.action === "delete") warnings.push({ severity: "high", code: "FILE_DELETION", path: c.path, message: "Deletes this file." });
    else if (c.deletions > 200) warnings.push({ severity: "medium", code: "LARGE_DELETION", path: c.path, message: `Removes ${c.deletions} lines.` });
  }
  return warnings;
}
