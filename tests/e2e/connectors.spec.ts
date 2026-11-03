import { expect, test } from "@playwright/test";

// Connectors UI against a mocked /api/connectors (real API and OAuth: scripts/check-connectors.cjs).

const status = (id: "github" | "google_drive", extra = {}) => ({
  id, label: id === "github" ? "GitHub" : "Google Drive", requiredEnv: id === "github" ? ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] : ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  scopes: id === "github" ? ["read:user", "repo"] : ["https://www.googleapis.com/auth/drive.readonly"],
  keyConfigured: true, configured: true, enabled: true, connected: false, account: null, grantedScopes: [], connectedAt: null, ...extra,
});

test("Connectors: setup guidance, connect redirect, read-only browsing, disconnect, OAuth error", async ({ page }) => {
  test.setTimeout(60_000);
  let mode: "unconfigured" | "ready" | "connected" = "unconfigured";
  const requests: string[] = [];
  await page.route("**/api/connectors**", async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    requests.push(`${method} ${url.pathname}`);
    const ok = (data: unknown, s = 200) => route.fulfill({ status: s, json: { data } });
    if (url.pathname === "/api/connectors") return ok(mode === "unconfigured"
      ? [status("github", { keyConfigured: false, configured: false }), status("google_drive", { keyConfigured: false, configured: false })]
      : [status("github", mode === "connected" ? { connected: true, account: "octo", grantedScopes: ["repo"] } : {}), status("google_drive", mode === "connected" ? { connected: true, account: "octo@example.com" } : {})]);
    if (url.pathname === "/api/connectors/audit") return ok(mode === "connected" ? [{ provider: "github", action: "file.read", resource: "octo/app:README.md", outcome: "success", created_at: "2026-11-02T10:00:00.000Z" }] : []);
    if (url.pathname === "/api/connectors/github/connect" && method === "POST") return ok({ url: "/connectors?connected=github" });
    if (url.pathname === "/api/connectors/github/repos") return ok([{ fullName: "octo/app", private: true, defaultBranch: "main", description: "Demo", updatedAt: "2026-11-01T00:00:00.000Z" }]);
    if (url.pathname.endsWith("/tree")) return ok({ files: [{ path: "README.md", size: 5 }, { path: "src/index.ts", size: 20 }] });
    if (url.pathname.endsWith("/file")) return ok({ path: url.searchParams.get("path"), content: "Hello from the repo" });
    if (url.pathname === "/api/connectors/google_drive/files") return ok({ files: [
      { id: "doc12345", name: "Plan", mimeType: "application/vnd.google-apps.document", modifiedTime: null, size: null, webViewLink: null, readable: true },
      { id: "img12345", name: "Picture", mimeType: "image/png", modifiedTime: null, size: 10, webViewLink: null, readable: false },
    ] });
    if (url.pathname === "/api/connectors/google_drive/files/doc12345") return ok({ name: "Plan", content: "Drive plan text" });
    if (url.pathname === "/api/connectors/github" && method === "DELETE") { mode = "ready"; return route.fulfill({ status: 204 }); }
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });

  await page.goto("/connectors");
  await expect(page.getByRole("heading", { name: /Connectors/ })).toBeVisible();
  await expect(page.getByText("Experimental")).toBeVisible();
  await expect(page.getByText("Token encryption key not set.")).toBeVisible();
  const github = page.getByRole("region", { name: "GitHub" });
  await expect(github.getByText("Not configured")).toBeVisible();
  await expect(github.getByRole("button", { name: "Connect" })).toBeDisabled();
  await expect(github.getByText("GITHUB_CLIENT_ID")).toBeVisible();

  // Configured: Connect follows the provider URL returned by the server.
  mode = "ready";
  await page.reload();
  await expect(page.getByText("Token encryption key not set.")).toHaveCount(0);
  mode = "connected";
  await github.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("status")).toHaveText("Connected to GitHub.");
  await expect(page).toHaveURL(/\/connectors$/);

  // Read-only browsing: repos → tree → file; Drive list → doc, binary not readable.
  await expect(github.getByText("Connected as octo")).toBeVisible();
  await github.getByRole("button", { name: /octo\/app/ }).click();
  await github.getByRole("button", { name: "README.md" }).click();
  await expect(github.getByLabel("Contents of README.md")).toHaveText("Hello from the repo");
  const drive = page.getByRole("region", { name: "Google Drive" });
  await expect(drive.getByRole("button", { name: "Picture" })).toBeDisabled();
  await drive.getByRole("button", { name: "Plan" }).click();
  await expect(drive.getByLabel("Contents of Plan")).toHaveText("Drive plan text");
  await expect(page.getByRole("region", { name: "Connector activity" }).getByText("file.read")).toBeVisible();

  // Disconnect asks first, then refreshes.
  page.once("dialog", d => d.accept());
  await github.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("status")).toHaveText("Disconnected GitHub.");
  await expect(github.getByText("Not connected")).toBeVisible();
  expect(requests.filter(r => !r.startsWith("GET") && !r.startsWith("POST /api/connectors/github/connect") && !r.startsWith("DELETE"))).toEqual([]);

  // OAuth callback errors are shown in plain language.
  await page.goto("/connectors?error=INVALID_STATE");
  await expect(page.getByText("That sign-in link expired or was already used. Connect again.")).toBeVisible();
});
