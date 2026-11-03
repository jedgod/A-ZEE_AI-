import { expect, test } from "@playwright/test";

// AI Code Agent UI against a mocked /api/code-agent (real API, model and filesystem: scripts/check-code-agent.cjs).

const HASH = "f".repeat(64);
const plan = { summary: "Change the greeting.", files: [{ path: "greet.js", action: "modify", reason: "Holds the greeting" }], steps: ["Edit greet()"], tests: ["node --test"], refused: [{ path: ".env", reason: "SENSITIVE_PATH" }] };
const diff = {
  patchHash: HASH, explanation: "Greeting changed.", totals: { files: 2, additions: 2, deletions: 1 },
  review: [{ severity: "high", code: "DEPENDENCY_CHANGE", path: "package.json", message: "Changes dependencies: review new packages and versions." }],
  files: [
    { path: "greet.js", action: "modify", additions: 1, deletions: 1, diff: "--- a/greet.js\n+++ b/greet.js\n@@ -1,3 +1,3 @@\n export function greet(name) {\n-  return 'Hello, ' + name;\n+  return 'Hi, ' + name;\n }" },
    { path: "package.json", action: "modify", additions: 1, deletions: 0, diff: "--- a/package.json\n+++ b/package.json\n@@ -1,1 +1,2 @@\n {\n+  \"x\": 1" },
  ],
};

test("Code agent: plan, proposed changes, risk-acknowledged approval, apply, rollback conflict, history and audit", async ({ page }) => {
  test.setTimeout(60_000);
  let status = "draft";
  const mutations: { path: string; csrf: string | null; body: unknown }[] = [];
  const task = () => ({
    id: "11111111-1111-4111-8111-111111111111", repo: "demo", instruction: "Say Hi instead of Hello", status, explanation: status === "draft" ? null : "Greeting changed.",
    review: status === "draft" || status === "planned" ? [] : diff.review, patchHash: ["draft", "planned"].includes(status) ? null : HASH, patchVersion: 1,
    approved: status === "approved", error: null, model: "Groq", createdAt: "2026-11-03T10:00:00.000Z", appliedAt: null, rolledBackAt: null,
    plan: status === "draft" ? null : plan, changes: [],
  });
  await page.route("**/api/code-agent**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const ok = (data: unknown, s = 200) => route.fulfill({ status: s, json: { data } });
    if (req.method() !== "GET") mutations.push({ path: url.pathname, csrf: req.headers()["x-azee-request"] ?? null, body: req.postDataJSON?.() ?? null });
    const p = url.pathname;
    if (p === "/api/code-agent") return ok({ enabled: true, readiness: "implemented", configured: true, repos: ["demo"], execution: { enabled: false, readiness: "infrastructure_blocked", blockedBy: "No container runtime (Docker) or remote sandbox service is configured." } });
    if (p.endsWith("/git")) return ok({ branch: "main", upstream: null, ahead: 0, behind: 0, changes: [] });
    if (p.endsWith("/tree")) return ok({ files: [{ path: "README.md", size: 10 }, { path: "greet.js", size: 60 }], truncated: false });
    if (p === "/api/code-agent/tasks" && req.method() === "GET") return ok(status === "draft" ? [] : [task()]);
    if (p === "/api/code-agent/tasks") return ok(task(), 201);
    if (p.endsWith("/plan")) { status = "planned"; return ok(task()); }
    if (p.endsWith("/generate")) { status = "review"; return ok(task()); }
    if (p.endsWith("/diff")) return ok(diff);
    if (p.endsWith("/approve")) { status = "approved"; return ok(task()); }
    if (p.endsWith("/apply")) { status = "applied"; return ok(task()); }
    if (p.endsWith("/rollback")) return route.fulfill({ status: 409, json: { error: "ROLLBACK_CONFLICT", detail: { files: ["greet.js"] } } });
    if (p.endsWith("/audit")) return ok(status === "applied" ? [{ action: "task.apply", outcome: "success", patch_hash: HASH, detail: "2 files", created_at: "2026-11-03T10:05:00.000Z" }] : []);
    if (p.startsWith("/api/code-agent/tasks/")) return ok(task());
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });

  await page.goto("/code-agent");
  await expect(page.getByRole("heading", { name: /AI Code Agent/ })).toBeVisible();
  await expect(page.getByText("Code execution: Infrastructure blocked.")).toBeVisible();
  await expect(page.getByLabel("Git status")).toContainText("main");
  await expect(page.getByLabel("Repository files")).toContainText("greet.js");

  // Planning.
  await page.getByLabel("Task").fill("Say Hi instead of Hello");
  await page.getByRole("button", { name: "Create plan" }).click();
  const planBox = page.getByLabel("Plan", { exact: true });
  await expect(planBox).toContainText("Change the greeting.");
  await expect(planBox).toContainText("greet.js");
  await expect(planBox).toContainText("Refused: .env (SENSITIVE_PATH)");
  await expect(planBox).toContainText("Expected tests (not run)");

  // Proposed changes.
  await page.getByRole("button", { name: "Generate patch" }).click();
  await expect(page.getByLabel("Patch totals")).toContainText("2 file(s)");
  await expect(page.getByRole("list", { name: "Proposed changes" })).toContainText("package.json");

  // Diff review: high risk must be acknowledged before approval; apply only after approval.
  await page.getByRole("button", { name: "Review the diff" }).click();
  await expect(page.getByRole("list", { name: "Risk warnings" })).toContainText("Changes dependencies");
  await expect(page.getByLabel("Diff of greet.js")).toContainText("+  return 'Hi, ' + name;");
  const approveBtn = page.getByRole("button", { name: "Approve patch" });
  await expect(approveBtn).toBeDisabled();
  await expect(page.getByRole("button", { name: "Apply approved patch" })).toBeDisabled();
  await page.getByLabel("I've reviewed the high-risk warnings").check();
  await approveBtn.click();
  await expect(page.getByRole("status")).toHaveText("Patch approved. Nothing has been written yet.");
  await page.getByRole("button", { name: "Apply approved patch" }).click();
  await expect(page.getByRole("status")).toContainText("Applied 2 file change(s) to demo.");

  // History: rollback conflict is explained; audit shown.
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("list", { name: "Task history" })).toContainText("Applied");
  await expect(page.getByLabel("Task audit")).toContainText("task.apply");
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "Roll back" }).click();
  await expect(page.getByText(/^Some files were edited/)).toContainText("rollback was refused and nothing changed. (greet.js)");

  // Every mutation carried the CSRF header; approval and apply were bound to the reviewed hash.
  expect(mutations.every(m => m.csrf === "1")).toBe(true);
  expect(mutations.find(m => m.path.endsWith("/approve"))?.body).toEqual({ patchHash: HASH, acknowledgeRisks: true });
  expect(mutations.find(m => m.path.endsWith("/apply"))?.body).toEqual({ patchHash: HASH });
});
