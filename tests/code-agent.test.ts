import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CodeAgentError, normalizeRelative, repoRoot, resolveInRepo, workspaceConfig } from "@/lib/code-agent/paths";
import { applyEdits, patchHash, reviewChanges, scanSecrets, sha256, unifiedDiff } from "@/lib/code-agent/review";
import { prepareChanges } from "@/lib/code-agent/service";
import { applyChanges, listTree, readText, rollbackChanges } from "@/lib/code-agent/workspace";

// Workspace on the system temp drive (NTFS on Windows, so junctions and symlinks can be created).
const base = mkdtempSync(path.join(os.tmpdir(), "azee-agent-"));
const wsRoot = path.join(base, "workspace");
const outside = path.join(base, "outside");
const repo = path.join(wsRoot, "app");
const ws = { root: wsRoot, repos: ["app", "linked"] };
const code = (e: unknown) => (e as CodeAgentError).code;
const reject = async (p: Promise<unknown>) => { try { await p; } catch (e) { return code(e); } return "RESOLVED"; };

function reset() {
  rmSync(wsRoot, { recursive: true, force: true });
  mkdirSync(path.join(repo, "src"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, "data.txt"), "outside");
  writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\nexport const keep = true;\n");
  writeFileSync(path.join(repo, "src", "b.ts"), "export const b = 2;\n");
  writeFileSync(path.join(repo, "README.md"), "# App\n");
  writeFileSync(path.join(repo, ".env"), "TOKEN=abc");
  writeFileSync(path.join(repo, ".env.example"), "TOKEN=");
}
beforeEach(reset);
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** Junctions need no privileges on Windows; elsewhere a directory symlink. */
const linkDir = (target: string, link: string) => symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");

describe("workspace authorization and path safety", () => {
  it("reads only allowlisted repositories inside the workspace root", async () => {
    expect(workspaceConfig({ CODE_AGENT_WORKSPACE_ROOT: "relative/path", CODE_AGENT_REPOS: "app" })).toBeNull();
    expect(workspaceConfig({ CODE_AGENT_WORKSPACE_ROOT: wsRoot, CODE_AGENT_REPOS: "app, ../x, ., ok-2" })!.repos).toEqual(["app", "ok-2"]);
    expect(await repoRoot(ws, "app")).toBeTruthy();
    expect(await reject(repoRoot(ws, "other"))).toBe("REPO_NOT_AUTHORIZED");
    expect(await reject(repoRoot(ws, ".."))).toBe("REPO_NOT_AUTHORIZED");
    expect(await reject(repoRoot(null, "app"))).toBe("WORKSPACE_NOT_CONFIGURED");
    linkDir(outside, path.join(wsRoot, "linked"));   // an allowlisted name that points outside the root
    expect(await reject(repoRoot(ws, "linked"))).toBe("REPO_NOT_AUTHORIZED");
  });

  it("rejects traversal, absolute paths and Windows aliases", async () => {
    const root = await repoRoot(ws, "app");
    for (const bad of ["../outside/data.txt", "src/../../x", "/etc/passwd", "C:\\Windows\\win.ini", "\\\\server\\share", "..\\x"]) {
      expect(await reject(resolveInRepo(root, bad, "read")), bad).toBe("PATH_OUTSIDE_REPO");
    }
    for (const bad of ["src/a.ts:stream", "src/a.ts.", "src/a.ts ", "con", "src/nul.txt", "src//a.ts", "./src/a.ts", "a\0b"]) {
      expect(await reject(resolveInRepo(root, bad, "read")), bad).toBe("INVALID_PATH");
    }
    expect(normalizeRelative("src\\a.ts")).toBe("src/a.ts");
  });

  it("protects secrets, VCS internals and generated folders", async () => {
    const root = await repoRoot(ws, "app");
    for (const p of [".env", ".env.local", "config/.env.production", ".git/config", ".ssh/id_rsa", "id_ed25519", "certs/server.pem", "deploy/key.p12", ".npmrc", "credentials.json"]) {
      expect(await reject(resolveInRepo(root, p, "read")), p).toBe("SENSITIVE_PATH");
    }
    expect((await resolveInRepo(root, ".env.example", "read")).rel).toBe(".env.example");
    expect(await reject(resolveInRepo(root, "node_modules/x/index.js", "write"))).toBe("PROTECTED_PATH");
    expect((await resolveInRepo(root, "node_modules/x/index.js", "read")).rel).toBe("node_modules/x/index.js");
    const tree = (await listTree(root)).files.map(f => f.path);
    expect(tree).toContain(".env.example");
    expect(tree).not.toContain(".env");
  });

  it("refuses symlink and junction escapes, including for files that don't exist yet", async () => {
    const root = await repoRoot(ws, "app");
    linkDir(outside, path.join(repo, "escape"));
    expect(await reject(resolveInRepo(root, "escape/data.txt", "read"))).toBe("SYMLINK_REFUSED");
    expect(await reject(resolveInRepo(root, "escape/new.txt", "write"))).toBe("SYMLINK_REFUSED");
    expect((await listTree(root)).files.some(f => f.path.startsWith("escape"))).toBe(false);
    let fileLink = true;
    try { symlinkSync(path.join(outside, "data.txt"), path.join(repo, "link.txt"), "file"); } catch { fileLink = false; }   // needs privileges on Windows
    if (fileLink) expect(await reject(resolveInRepo(root, "link.txt", "read"))).toBe("SYMLINK_REFUSED");
  });

  it("reads only UTF-8 text files", async () => {
    writeFileSync(path.join(repo, "bin.dat"), Buffer.from([1, 0, 2]));
    writeFileSync(path.join(repo, "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    expect(await reject(readText(path.join(repo, "bin.dat")))).toBe("BINARY_FILE");
    expect(await reject(readText(path.join(repo, "latin1.txt")))).toBe("NOT_UTF8");
    expect(await readText(path.join(repo, "missing.txt"))).toBeNull();
  });
});

describe("patch generation and review", () => {
  it("applies exact, unique edits only", () => {
    const src = "a\nb\nc\nb\n";
    expect(applyEdits(src, [{ find: "a\n", replace: "A\n" }], "f")).toBe("A\nb\nc\nb\n");
    expect(() => applyEdits(src, [{ find: "zzz", replace: "" }], "f")).toThrow("EDIT_NOT_FOUND");
    expect(() => applyEdits(src, [{ find: "b\n", replace: "B\n" }], "f")).toThrow("EDIT_AMBIGUOUS");
    expect(() => applyEdits(src, [{ find: "a", replace: "a" }], "f")).toThrow("EDIT_NO_CHANGE");
    expect(applyEdits("x\r\ny\r\n", [{ find: "x\ny", replace: "x\nz" }], "f")).toBe("x\r\nz\r\n");
  });

  it("produces unified diffs with counts", () => {
    const d = unifiedDiff("f.ts", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n", "1\n2\nthree\n4\n5\n6\n7\n8\n9\n10\neleven\n");
    expect(d).toMatchObject({ additions: 2, deletions: 1 });
    expect(d.diff.split("\n").slice(0, 3)).toEqual(["--- a/f.ts", "+++ b/f.ts", "@@ -1,6 +1,6 @@"]);
    expect(d.diff).toContain("-3\n+three");
    expect(d.diff).toContain("+eleven");
    expect(unifiedDiff("n.ts", null, "x\n").diff).toBe("--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,1 @@\n+x");
    expect(unifiedDiff("n.ts", "x\n", null)).toMatchObject({ additions: 0, deletions: 1 });
  });

  it("blocks added secrets and flags risky changes", () => {
    const token = "ghp_" + "a".repeat(36);
    expect(scanSecrets(`+const t = "${token}";`)).toEqual(["GitHub token"]);
    expect(scanSecrets(`-const t = "${token}";`)).toEqual([]);   // removing a secret isn't introducing one
    const change = (p: string, diff: string, action: "modify" | "delete" = "modify") => ({ path: p, action, baseHash: "x", baseContent: "", newHash: "y", newContent: "", diff, additions: 1, deletions: 0 });
    const w = reviewChanges([change("src/x.ts", `+const k = "${token}"`), change("package.json", "+dep"), change("old.ts", "-x", "delete"), change("migrations/019.sql", "+x"), change("lib/auth.ts", "+x")]);
    expect(w.map(x => [x.severity, x.code])).toEqual([
      ["block", "SECRET_DETECTED"], ["high", "DEPENDENCY_CHANGE"], ["high", "FILE_DELETION"], ["high", "DATABASE_MIGRATION"], ["medium", "SECURITY_SENSITIVE"],
    ]);
    expect(w[0].message).not.toContain(token);   // warnings never echo the secret
  });

  it("only accepts planned files and binds the patch hash to file contents", async () => {
    const root = await repoRoot(ws, "app");
    const planned = [{ path: "src/a.ts", action: "modify" as const, reason: "" }, { path: "src/new.ts", action: "create" as const, reason: "" }];
    expect(await reject(prepareChanges(root, planned, [{ path: "src/b.ts", action: "delete" }]))).toBe("CHANGE_NOT_IN_PLAN");
    expect(await reject(prepareChanges(root, planned, [{ path: "src/a.ts", action: "delete" }]))).toBe("CHANGE_ACTION_MISMATCH");
    expect(await reject(prepareChanges(root, [{ path: ".env", action: "modify", reason: "" }], [{ path: ".env", action: "modify", edits: [{ find: "abc", replace: "x" }] }]))).toBe("SENSITIVE_PATH");
    const changes = await prepareChanges(root, planned, [
      { path: "src/a.ts", action: "modify", edits: [{ find: "export const a = 1;", replace: "export const a = 42;" }] },
      { path: "src/new.ts", action: "create", content: "export const n = 0;\n" },
    ]);
    expect(changes.map(c => [c.path, c.action, c.additions, c.deletions])).toEqual([["src/a.ts", "modify", 1, 1], ["src/new.ts", "create", 1, 0]]);
    expect(changes[0].baseHash).toBe(sha256(readFileSync(path.join(repo, "src/a.ts"), "utf8")));
    expect(readFileSync(path.join(repo, "src/a.ts"), "utf8")).toContain("a = 1;");   // generating writes nothing
    expect(existsSync(path.join(repo, "src/new.ts"))).toBe(false);
    const other = [{ ...changes[0], newHash: sha256("different") }, changes[1]];
    expect(patchHash(changes)).toMatch(/^[a-f0-9]{64}$/);
    expect(patchHash(other)).not.toBe(patchHash(changes));
  });
});

describe("apply and rollback", () => {
  const prepare = async () => {
    const root = await repoRoot(ws, "app");
    const planned = [
      { path: "src/a.ts", action: "modify" as const, reason: "" }, { path: "src/b.ts", action: "delete" as const, reason: "" },
      { path: "src/deep/dir/new.ts", action: "create" as const, reason: "" },
    ];
    const changes = await prepareChanges(root, planned, [
      { path: "src/a.ts", action: "modify", edits: [{ find: "a = 1", replace: "a = 2" }] },
      { path: "src/b.ts", action: "delete" },
      { path: "src/deep/dir/new.ts", action: "create", content: "new\n" },
    ]);
    return { root, changes };
  };
  const read = (p: string) => existsSync(path.join(repo, p)) ? readFileSync(path.join(repo, p), "utf8") : null;

  it("applies every file, then rolls back exactly the agent's changes", async () => {
    const { root, changes } = await prepare();
    writeFileSync(path.join(repo, "README.md"), "# App\nuser edit\n");   // an unrelated user change
    const { createdDirs } = await applyChanges(root, changes);
    expect(createdDirs).toEqual(["src/deep", "src/deep/dir"]);
    expect([read("src/a.ts")?.includes("a = 2"), read("src/b.ts"), read("src/deep/dir/new.ts")]).toEqual([true, null, "new\n"]);
    await rollbackChanges(root, changes, createdDirs);
    expect(read("src/a.ts")).toBe("export const a = 1;\nexport const keep = true;\n");
    expect(read("src/b.ts")).toBe("export const b = 2;\n");
    expect(existsSync(path.join(repo, "src/deep"))).toBe(false);
    expect(read("README.md")).toBe("# App\nuser edit\n");   // untouched
  });

  it("detects files changed after generation and writes nothing", async () => {
    const { root, changes } = await prepare();
    writeFileSync(path.join(repo, "src/b.ts"), "export const b = 3;\n");
    const err = await applyChanges(root, changes).catch(e => e as CodeAgentError);
    expect(err).toMatchObject({ code: "STALE_PATCH", detail: { files: ["src/b.ts"] } });
    expect(read("src/a.ts")).toContain("a = 1");
    expect(existsSync(path.join(repo, "src/deep"))).toBe(false);
  });

  it("restores earlier files when a later write fails", async () => {
    const { root, changes } = await prepare();
    const err = await applyChanges(root, changes, { beforeWrite: i => { if (i === 2) throw new Error("disk full"); } }).catch(e => e as CodeAgentError);
    expect(err).toMatchObject({ code: "APPLY_FAILED", detail: { recovered: true, unrecovered: [] } });
    expect(read("src/a.ts")).toBe("export const a = 1;\nexport const keep = true;\n");
    expect(read("src/b.ts")).toBe("export const b = 2;\n");
    expect(existsSync(path.join(repo, "src/deep"))).toBe(false);
  });

  it("refuses rollback when a user edited an agent-changed file, changing nothing", async () => {
    const { root, changes } = await prepare();
    const { createdDirs } = await applyChanges(root, changes);
    writeFileSync(path.join(repo, "src/a.ts"), "export const a = 2; // user tweak\n");
    const err = await rollbackChanges(root, changes, createdDirs).catch(e => e as CodeAgentError);
    expect(err).toMatchObject({ code: "ROLLBACK_CONFLICT", detail: { files: ["src/a.ts"] } });
    expect(read("src/a.ts")).toBe("export const a = 2; // user tweak\n");
    expect(read("src/deep/dir/new.ts")).toBe("new\n");   // the other agent files weren't touched either
    expect(read("src/b.ts")).toBeNull();
  });

  it("refuses to write through a junction planted after generation", async () => {
    const { root, changes } = await prepare();
    linkDir(outside, path.join(repo, "src", "deep"));
    const err = await applyChanges(root, changes).catch(e => e as CodeAgentError);
    expect(code(err)).toBe("SYMLINK_REFUSED");
    expect(existsSync(path.join(outside, "dir", "new.ts"))).toBe(false);
    expect(read("src/a.ts")).toContain("a = 1");
  });
});
