import { expect, test } from "@playwright/test";

// A-Zee Search UI against a mocked /api/v1 (real API: scripts/check-search.cjs).

const source = (n: number, extra = {}) => ({
  n, id: `00000000-0000-4000-8000-00000000000${n}`, title: `Source ${n}`, url: `https://example.org/${n}`, domain: "example.org",
  publishedAt: "2026-10-30T00:00:00.000Z", retrievedAt: "2026-11-02T10:00:00.000Z", relevance: 0.8, freshness: { label: "fresh", ageDays: 3 }, ...extra,
});

test("A-Zee Search: setup banner, cited answer with verified claims, research job, compare; platform overview", async ({ page }) => {
  test.setTimeout(60_000);
  let configured = false;
  let polls = 0;
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const ok = (data: unknown, status = 200) => route.fulfill({ status, json: { data } });
    if (url.pathname === "/api/v1/search/status") return ok({ configured, provider: "tavily" });
    if (url.pathname === "/api/v1/search/query") return ok({
      id: "a1", query: "When did JWST launch?", answer: "JWST launched on 25 December 2021 [1] aboard an Ariane 5 [2].",
      sources: [source(1), source(2, { publishedAt: null, freshness: { label: "unknown", ageDays: null } })],
      claims: [
        { text: "JWST launched on 25 December 2021.", status: "verified", citations: [{ n: 1, quote: "launched on 25 December 2021 aboard an Ariane 5", found: true }] },
        { text: "It launched from Florida.", status: "unverified", citations: [{ n: 2, quote: "lifted off from Florida", found: false }] },
      ],
      verification: { verified: 1, unverified: 1, uncited: 0, total: 2 }, unknownCitations: [], model: "Groq", provider: "tavily", retrievedAt: "2026-11-02T10:00:00.000Z",
    });
    if (url.pathname === "/api/v1/search/deep-research") return ok({ id: "11111111-1111-4111-8111-111111111111", question: "JWST?", status: "running", phase: "plan", plan: [], progress: { done: 0, total: 0 }, steps: [], error: null, model: null, hasReport: false, createdAt: "2026-11-02T10:00:00.000Z" }, 202);
    if (url.pathname === "/api/v1/research/jobs") return ok([]);
    if (url.pathname.endsWith("/report")) return ok({
      title: "JWST launch report", question: "JWST?", summary: "## Findings\n\nIt launched in 2021 [1].", gaps: ["Launch costs"],
      evidence: [{ claim: "Launched in 2021", source: 1, quote: "launched on 25 December 2021", verified: true }],
      conflicts: [{ topic: "Launch site", positions: [{ claim: "French Guiana", sources: [1] }, { claim: "Florida", sources: [2] }] }],
      references: [{ n: 1, title: "Source 1", url: "https://example.org/1", domain: "example.org", publishedAt: null, retrievedAt: "2026-11-02T10:00:00.000Z", freshness: "unknown" }],
      verification: { verified: 1, unverified: 0, total: 1 }, model: "Groq", provider: "tavily", generatedAt: "2026-11-02T10:01:00.000Z",
    });
    if (url.pathname.startsWith("/api/v1/research/jobs/") && method === "GET") {
      polls++;
      const done = polls > 1;
      return ok({ id: "11111111-1111-4111-8111-111111111111", question: "JWST?", status: done ? "completed" : "running", phase: done ? "done" : "investigate",
        plan: ["When?", "Where?"], progress: { done: done ? 2 : 1, total: 2 },
        steps: [{ question: "When?", sources: 3, findings: 2, verified: 2 }, ...(done ? [{ question: "Where?", sources: 2, findings: 1, verified: 1 }] : [])],
        error: null, model: "Groq", hasReport: done, createdAt: "2026-11-02T10:00:00.000Z" });
    }
    if (url.pathname === "/api/v1/search/compare") return ok({
      a: "PostgreSQL", b: "MySQL", summary: "Both are relational [1].", verification: { verified: 1, unverified: 1, total: 2 }, model: "Groq", retrievedAt: "2026-11-02T10:00:00.000Z",
      sources: [source(1)], rows: [{ aspect: "Licensing",
        a: { text: "PostgreSQL License", status: "verified", citations: [{ n: 1, quote: "released under the PostgreSQL License", found: true }] },
        b: { text: "GPL", status: "unverified", citations: [{ n: 1, quote: "dual licensed GPL", found: false }] } }],
    });
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });

  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "A-Zee Search" })).toBeVisible();
  await expect(page.getByText("Live web search isn't set up yet.")).toBeVisible();

  configured = true;
  await page.reload();
  await expect(page.getByText("Live web search isn't set up yet.")).toHaveCount(0);
  await page.getByLabel("Search the web").fill("When did JWST launch?");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("aboard an Ariane 5 [2]", { exact: false })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "1 of 2 claims verified against the source text" })).toBeVisible();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await expect(page.getByText("Quote not found", { exact: true })).toBeVisible();
  await expect(page.getByText("(not found in the source)")).toBeVisible();
  const sources = page.getByRole("list", { name: "Sources" });
  await expect(sources.getByRole("link", { name: /Source 1/ })).toHaveAttribute("href", "https://example.org/1");
  await expect(sources.getByRole("link", { name: /Source 1/ })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(sources).toContainText("Date unknown");

  // Search → Deep research hands the question over; progress then the report.
  await page.getByRole("button", { name: "Deep research this" }).click();
  await expect(page.getByLabel("Research question")).toHaveValue("When did JWST launch?");
  await page.getByRole("button", { name: "Start research" }).click();
  await expect(page.getByText("Investigate 1/2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "JWST launch report" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("1 of 1 findings verified against the source text")).toBeVisible();
  await expect(page.getByText("Conflicting claims")).toBeVisible();
  await expect(page.getByText("Launch costs")).toBeVisible();
  await expect(page.getByRole("link", { name: "Export Markdown" })).toHaveAttribute("href", /\/report\?format=md$/);

  await page.getByRole("tab", { name: "Compare" }).click();
  await page.getByLabel("Option A").fill("PostgreSQL");
  await page.getByLabel("Option B").fill("MySQL");
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Licensing" })).toBeVisible();
  await expect(page.getByText("1 of 2 cells verified against the source text")).toBeVisible();

  // Platform overview: the architecture and all 25 modules.
  await page.goto("/platform");
  await expect(page.getByRole("heading", { name: "A-Zee AI", exact: true })).toBeVisible();
  await expect(page.getByText("A-Zee Orchestration Engine")).toBeVisible();
  await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(25);
  await expect(page.getByRole("heading", { name: "Release acceptance criteria" })).toBeVisible();
});

test("sidebar links to A-Zee Search", async ({ page }) => {
  await page.route(/\/api\/(sidebar|projects|chats)(\/|\?|$)/, route => route.fulfill({ status: 401, json: {} }));
  await page.goto("/");
  await expect(page.locator("aside").getByRole("link", { name: "A-Zee Search" })).toHaveAttribute("href", "/search");
});
