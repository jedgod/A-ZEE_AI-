import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodeAgentError, isSensitive, resolveInRepo } from "./paths";
import { sha256, type PreparedChange } from "./review";

// Filesystem side of the agent. Reads are size-capped UTF-8 regular files. Applying a patch first
// checks every file still holds exactly what the patch was generated against (optimistic
// concurrency), then writes each file via temp-file + rename, undoing earlier files if a later one
// fails. Rollback only touches the agent's files, and only when they still hold the agent's content.

export const MAX_FILE_BYTES = 256_000;
const SKIP_DIRS = new Set([".git", "node_modules", ".next", ".mirror", "dist", "build", "coverage", ".venv", "venv", "__pycache__", ".turbo", ".cache", "test-results"]);

/** UTF-8 text of a regular file, or null when it doesn't exist. Refuses binaries and non-UTF-8 content. */
export async function readText(abs: string): Promise<string | null> {
  let info;
  try { info = await lstat(abs); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (info.isSymbolicLink()) throw new CodeAgentError(403, "SYMLINK_REFUSED");
  if (!info.isFile()) throw new CodeAgentError(422, "NOT_A_REGULAR_FILE");
  if (info.size > MAX_FILE_BYTES) throw new CodeAgentError(413, "FILE_TOO_LARGE");
  const handle = await open(abs, "r");
  try {
    const buf = await handle.readFile();
    if (buf.length > MAX_FILE_BYTES) throw new CodeAgentError(413, "FILE_TOO_LARGE");
    if (buf.includes(0)) throw new CodeAgentError(422, "BINARY_FILE");
    const text = buf.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(buf)) throw new CodeAgentError(422, "NOT_UTF8");   // rewriting it would change bytes
    return text;
  } finally { await handle.close(); }
}

export async function readRepoFile(root: string, rel: string) {
  const { rel: clean, abs } = await resolveInRepo(root, rel, "read");
  const content = await readText(abs);
  if (content === null) throw new CodeAgentError(404, "FILE_NOT_FOUND");
  return { path: clean, content, hash: sha256(content), bytes: Buffer.byteLength(content) };
}

/** Repository files (no symlinks, no sensitive files, generated folders skipped), capped. */
export async function listTree(root: string, limit = 5000) {
  const files: { path: string; size: number }[] = [];
  let truncated = false;
  const walk = async (dir: string, prefix: string, depth: number) => {
    if (depth > 12) return;
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.length >= limit) { truncated = true; return; }
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isSymbolicLink() || isSensitive(rel)) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name), rel, depth + 1); }
      else if (e.isFile()) files.push({ path: rel, size: (await lstat(path.join(dir, e.name))).size });
    }
  };
  await walk(root, "", 0);
  return { files, truncated };
}

/**
 * Branch and working-tree status from a fixed, read-only git command (no shell, no user input).
 * Repository config can't run programs here: fsmonitor and hooks are disabled, system config ignored.
 */
export function gitInfo(root: string): Promise<{ branch: string | null; upstream: string | null; ahead: number; behind: number; head: string | null; changes: { status: string; path: string }[] } | null> {
  const args = ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${os.devNull}`, "-c", "core.untrackedCache=false",
    "-C", root, "status", "--porcelain=v1", "--branch", "--untracked-files=normal", "-z"];
  return new Promise(resolve => {
    execFile("git", args, {
      timeout: 5000, maxBuffer: 1_000_000, windowsHide: true,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", HOME: os.tmpdir() } as unknown as NodeJS.ProcessEnv, encoding: "utf8",
    }, (error, stdout) => {
      if (error) return resolve(null);
      const records = stdout.split("\0").filter(Boolean);
      const head = records.shift() ?? "";
      const m = /^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?/.exec(head);
      const changes: { status: string; path: string }[] = [];
      for (let i = 0; i < records.length && changes.length < 500; i++) {
        const r = records[i];
        if (!isSensitive(r.slice(3))) changes.push({ status: r.slice(0, 2), path: r.slice(3) });   // like the tree, never list secrets
        if (r[0] === "R" || r[0] === "C") i++;   // rename/copy: next record is the source path
      }
      resolve({ branch: m?.[1] ?? null, upstream: m?.[2] ?? null, ahead: Number(m?.[3] ?? 0), behind: Number(m?.[4] ?? 0), head: null, changes });
    });
  });
}

export type ApplyHooks = { beforeWrite?: (index: number, rel: string) => void | Promise<void> };

async function atomicWrite(abs: string, content: string) {
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.azee-${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(tmp, content, { encoding: "utf8", flag: "wx" });
  try { await rename(tmp, abs); } catch (error) { await unlink(tmp).catch(() => {}); throw error; }
}

/** Paths whose current content no longer matches what the patch expects. */
export async function staleFiles(root: string, changes: PreparedChange[], expect: "base" | "new") {
  const stale: string[] = [];
  for (const c of changes) {
    const { abs } = await resolveInRepo(root, c.path, "write");
    let current: string | null;
    try { current = await readText(abs); } catch { stale.push(c.path); continue; }
    const want = expect === "base" ? c.baseHash : c.newHash;
    if ((current === null ? null : sha256(current)) !== want) stale.push(c.path);
  }
  return stale;
}

/** Applies all changes or none: on failure, files already written are restored from their snapshots. */
export async function applyChanges(root: string, changes: PreparedChange[], hooks: ApplyHooks = {}) {
  const stale = await staleFiles(root, changes, "base");
  if (stale.length) throw new CodeAgentError(409, "STALE_PATCH", { files: stale });
  const createdDirs: string[] = [];
  const done: PreparedChange[] = [];
  try {
    for (const [i, c] of changes.entries()) {
      const { abs } = await resolveInRepo(root, c.path, "write");   // re-checked right before writing
      await hooks.beforeWrite?.(i, c.path);
      const current = await readText(abs);
      if ((current === null ? null : sha256(current)) !== c.baseHash) throw new CodeAgentError(409, "STALE_PATCH", { files: [c.path] });
      if (c.action === "delete") await unlink(abs);
      else {
        // Create missing parent folders one by one so rollback can remove exactly those.
        const missing: string[] = [];
        for (let dir = path.dirname(abs); dir !== root; dir = path.dirname(dir)) {
          try { await lstat(dir); break; } catch { missing.unshift(dir); }
        }
        for (const dir of missing) { await mkdir(dir); createdDirs.push(path.relative(root, dir).split(path.sep).join("/")); }
        await atomicWrite(abs, c.newContent ?? "");
      }
      done.push(c);
    }
  } catch (error) {
    const failed = await restore(root, done.reverse(), createdDirs);
    throw new CodeAgentError(error instanceof CodeAgentError && error.code === "STALE_PATCH" ? 409 : 500, error instanceof CodeAgentError && error.code === "STALE_PATCH" ? "STALE_PATCH" : "APPLY_FAILED",
      { recovered: failed.length === 0, unrecovered: failed, ...(error instanceof CodeAgentError && error.detail && typeof error.detail === "object" ? error.detail : {}) });
  }
  return { createdDirs };
}

/** Puts each file back to its snapshot (or removes it if the change created it). Returns paths that failed. */
async function restore(root: string, changes: PreparedChange[], createdDirs: string[]) {
  const failed: string[] = [];
  for (const c of changes) {
    try {
      const { abs } = await resolveInRepo(root, c.path, "write");
      if (c.action === "create") await unlink(abs);
      else await atomicWrite(abs, c.baseContent ?? "");
    } catch { failed.push(c.path); }
  }
  for (const dir of [...createdDirs].reverse()) await rmdir(path.join(root, ...dir.split("/"))).catch(() => {});   // only if still empty
  return failed;
}

/** Undoes an applied patch, refusing (and changing nothing) if any of its files was edited since. */
export async function rollbackChanges(root: string, changes: PreparedChange[], createdDirs: string[]) {
  const conflicts = await staleFiles(root, changes, "new");
  if (conflicts.length) throw new CodeAgentError(409, "ROLLBACK_CONFLICT", { files: conflicts });
  const failed = await restore(root, [...changes].reverse(), createdDirs);
  if (failed.length) throw new CodeAgentError(500, "ROLLBACK_INCOMPLETE", { files: failed });
}
