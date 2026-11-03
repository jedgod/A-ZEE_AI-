import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

// Where the code agent may read and write. Repositories are directories directly under
// CODE_AGENT_WORKSPACE_ROOT, and only those named in CODE_AGENT_REPOS are authorized. Every path the
// agent touches goes through resolveInRepo: relative, no traversal, no Windows aliases, no
// sensitive files, and no symlink (or junction) anywhere between the repository root and the file.

export class CodeAgentError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail?: unknown) { super(code); }
}

export type Workspace = { root: string; repos: string[] };

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

export function workspaceConfig(env: Record<string, string | undefined> = process.env): Workspace | null {
  const root = env.CODE_AGENT_WORKSPACE_ROOT?.trim();
  if (!root || !path.isAbsolute(root)) return null;
  const repos = (env.CODE_AGENT_REPOS ?? "").split(",").map(s => s.trim()).filter(r => REPO_NAME.test(r) && r !== "." && r !== "..");
  return { root: path.resolve(root), repos: [...new Set(repos)] };
}

const within = (base: string, target: string) => {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** Real path of an authorized repository; 403 for anything not on the allowlist. */
export async function repoRoot(ws: Workspace | null, repo: string): Promise<string> {
  if (!ws) throw new CodeAgentError(503, "WORKSPACE_NOT_CONFIGURED");
  if (!REPO_NAME.test(repo) || repo === "." || repo === ".." || !ws.repos.includes(repo)) throw new CodeAgentError(403, "REPO_NOT_AUTHORIZED");
  const candidate = path.join(ws.root, repo);
  let info;
  try { info = await lstat(candidate); } catch { throw new CodeAgentError(404, "REPO_NOT_FOUND"); }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new CodeAgentError(403, "REPO_NOT_AUTHORIZED");
  const [realRoot, realRepo] = await Promise.all([realpath(ws.root), realpath(candidate)]);
  if (!within(realRoot, realRepo) || realRepo === realRoot) throw new CodeAgentError(403, "REPO_NOT_AUTHORIZED");
  return realRepo;
}

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// Never read or written: VCS internals, credentials and keys.
const SENSITIVE = [
  /(^|\/)\.git(\/|$)/i, /(^|\/)\.ssh(\/|$)/i, /(^|\/)\.env(\.(?!example$)[^/]*)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i, /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|\/)\.(npmrc|pypirc|netrc|pgpass)$/i, /(^|\/)(credentials|secrets?)(\.(json|ya?ml|txt|ini|toml|xml))?$/i, /(^|\/)\.aws(\/|$)/i,
];
// Readable, but the agent doesn't write here.
const WRITE_PROTECTED = [/(^|\/)node_modules(\/|$)/i, /(^|\/)\.next(\/|$)/i, /(^|\/)\.mirror(\/|$)/i, /(^|\/)\.venv(\/|$)/i];

export const isSensitive = (rel: string) => SENSITIVE.some(r => r.test(rel));

/** Validates a repository-relative path and returns it normalized with forward slashes. */
export function normalizeRelative(raw: string): string {
  if (typeof raw !== "string" || !raw || raw.length > 400 || raw.includes("\0")) throw new CodeAgentError(400, "INVALID_PATH");
  const rel = raw.replace(/\\/g, "/");
  if (rel.startsWith("/") || /^[a-z]:/i.test(rel) || rel.startsWith("//")) throw new CodeAgentError(403, "PATH_OUTSIDE_REPO");
  const parts = rel.split("/");
  for (const part of parts) {
    if (part === "..") throw new CodeAgentError(403, "PATH_OUTSIDE_REPO");
    // Empty or "." segments, NTFS streams ("a:b"), trailing dots/spaces and device names all alias other files on Windows.
    if (!part || part === "." || part.includes(":") || /[. ]$/.test(part) || WINDOWS_DEVICE.test(part) || /[<>"|?*\x00-\x1f]/.test(part)) throw new CodeAgentError(400, "INVALID_PATH");
  }
  return parts.join("/");
}

/**
 * Absolute path of `raw` inside `root` (a real path from repoRoot). Refuses sensitive files,
 * protected folders for writes, and any symlink on the way (checked on every existing component).
 */
export async function resolveInRepo(root: string, raw: string, mode: "read" | "write"): Promise<{ rel: string; abs: string }> {
  const rel = normalizeRelative(raw);
  if (isSensitive(rel)) throw new CodeAgentError(403, "SENSITIVE_PATH");
  if (mode === "write" && WRITE_PROTECTED.some(r => r.test(rel))) throw new CodeAgentError(403, "PROTECTED_PATH");
  const abs = path.join(root, ...rel.split("/"));
  if (!within(root, abs) || abs === root) throw new CodeAgentError(403, "PATH_OUTSIDE_REPO");
  let current = root;
  for (const part of rel.split("/")) {
    current = path.join(current, part);
    let info;
    try { info = await lstat(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;   // the rest doesn't exist yet
      throw error;
    }
    if (info.isSymbolicLink()) throw new CodeAgentError(403, "SYMLINK_REFUSED");
  }
  // Belt and braces: the deepest existing ancestor must really be inside the repository.
  let probe = abs;
  for (;;) {
    try { await stat(probe); break; } catch { const up = path.dirname(probe); if (up === probe) break; probe = up; }
  }
  if (!within(root, await realpath(probe))) throw new CodeAgentError(403, "PATH_OUTSIDE_REPO");
  return { rel, abs };
}
