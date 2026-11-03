import { expect, test } from "@playwright/test";

// "My index" tab of A-Zee Search against a mocked /api/v1/search/index (real API and database: scripts/check-search-index.cjs).

const COL = "11111111-1111-4111-8111-111111111111";
const doc = (id: string, title: string, extra = {}) => ({ id, collectionId: COL, sourceType: "text", sourceRef: null, title, url: null, version: 1, chunks: 1, bytes: 40, indexedAt: "2026-11-03T10:00:00.000Z", lastSyncedAt: null, ...extra });

test("My index: create collection, add text, duplicate notice, search with provenance, sync and delete", async ({ page }) => {
  test.setTimeout(60_000);
  const collections: { id: string; name: string; documents: number }[] = [];
  let docs: ReturnType<typeof doc>[] = [];
  const mutations: { path: string; method: string; csrf: string | null; body: unknown }[] = [];
  await page.route("**/api/v1/search/status", route => route.fulfill({ json: { data: { configured: false, provider: "tavily" } } }));
  await page.route("**/api/v1/search/index**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname, m = req.method();
    const ok = (data: unknown, s = 200) => route.fulfill({ status: s, json: { data } });
    if (m !== "GET") mutations.push({ path: p, method: m, csrf: req.headers()["x-azee-request"] ?? null, body: req.postDataJSON?.() ?? null });
    if (p === "/api/v1/search/index") return ok({ enabled: true, readiness: "locally_tested", engine: "postgresql_fts", vectorSearch: { readiness: "infrastructure_blocked", extensionAvailable: false, blockedBy: "pgvector" } });
    if (p.endsWith("/collections") && m === "GET") return ok(collections.map(c => ({ ...c, documents: docs.length })));
    if (p.endsWith("/collections")) { collections.push({ id: COL, name: "Team docs", documents: 0 }); return ok(collections[0], 201); }
    if (p.endsWith("/documents") && m === "GET") return ok(docs);
    if (p.endsWith("/documents")) {
      const body = req.postDataJSON();
      if (body.source === "github") { const d = doc("33333333-3333-4333-8333-333333333333", "acme/docs/guides/deploy.md", { sourceType: "github", url: "https://github.com/acme/docs/blob/main/guides/deploy.md" }); docs.push(d); return ok({ outcome: "created", document: d }, 201); }
      if (docs.some(d => d.title === "Lighthouse")) return ok({ outcome: "duplicate", document: docs[0] });
      const d = doc("22222222-2222-4222-8222-222222222222", body.title); docs.push(d); return ok({ outcome: "created", document: d }, 201);
    }
    if (p.endsWith("/sync")) return ok({ outcome: "updated", document: { ...docs[1], version: 2 } });
    if (p.endsWith("/query")) return ok({ query: url.searchParams.get("q"), results: [{
      n: 1, rank: 0.4, excerpt: "The quillfeather lighthouse uses a Fresnel lens.",
      source: { documentId: docs[0].id, title: "Lighthouse", sourceType: "text", url: null, version: 1, contentHash: "h", indexedAt: "2026-11-03T10:00:00.000Z", collection: "Team docs" },
      location: { chunk: 0, start: 0, end: 52 },
    }] });
    if (m === "DELETE") { docs = docs.filter(d => !p.endsWith(d.id)); return route.fulfill({ status: 204 }); }
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });

  await page.goto("/search");
  await expect(page.getByText("Live web search isn't set up yet.")).toBeVisible();   // the index still works without Tavily
  await page.getByRole("tab", { name: "My index" }).click();
  await expect(page.getByLabel("Index status")).toContainText("Vector search: Infrastructure blocked (pgvector isn't installed)");
  await expect(page.getByText("never indexed automatically")).toBeVisible();

  await page.getByLabel("New collection name").fill("Team docs");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Collection", { exact: true })).toHaveValue(COL);

  await page.getByLabel("Document title").fill("Lighthouse");
  await page.getByLabel("Document text").fill("The quillfeather lighthouse uses a Fresnel lens.");
  await page.getByRole("button", { name: "Add to index" }).click();
  await expect(page.getByRole("status").filter({ hasNotText: "Live web search" })).toContainText("Indexed. “Lighthouse” (version 1, 1 chunk).");
  await page.getByLabel("Document title").fill("Lighthouse");
  await page.getByLabel("Document text").fill("The quillfeather lighthouse uses a Fresnel lens.");
  await page.getByRole("button", { name: "Add to index" }).click();
  await expect(page.getByRole("status").filter({ hasNotText: "Live web search" })).toContainText("not added again");

  await page.getByLabel("GitHub").check();
  await page.getByLabel("Repository").fill("acme/docs");
  await page.getByLabel("File path").fill("guides/deploy.md");
  await page.getByRole("button", { name: "Add to index" }).click();
  await expect(page.getByRole("list", { name: "Indexed documents" })).toContainText("acme/docs/guides/deploy.md");

  await page.getByLabel("Search your index").fill("quillfeather");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const results = page.getByRole("list", { name: "Index results" });
  await expect(results.locator("mark")).toHaveText("quillfeather");
  await expect(results).toContainText("Team docs · v1 · chunk 1 (chars 0–52)");

  await page.getByRole("button", { name: "Sync acme/docs/guides/deploy.md" }).click();
  await expect(page.getByRole("status").filter({ hasNotText: "Live web search" })).toContainText("re-indexed as a new version");
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "Remove Lighthouse" }).click();
  await expect(page.getByRole("status").filter({ hasNotText: "Live web search" })).toContainText("Removed “Lighthouse” from the index.");
  await expect(results).toContainText("No matching documents.");   // its result is gone too

  expect(mutations.every(x => x.csrf === "1")).toBe(true);
  expect(mutations.find(x => x.path.endsWith("/documents") && (x.body as { source: string }).source === "github")?.body).toEqual({ source: "github", collectionId: COL, repo: "acme/docs", path: "guides/deploy.md" });
});
