import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import fs from "node:fs";
import pg from "pg";

// AZTrade in a REAL browser against REAL services: A-Zee (Next.js, its PostgreSQL), the AZTrade API (its PostgreSQL 16 with
// the restricted roles) and A-Zee's real chat pipeline in its explicit dev "demo response" mode (no model provider is called).
// No request is mocked, except the one deliberate network cut in the idempotency test. Started by AZTrade scripts/run-e2e.ps1.
test.skip(!process.env.AZTRADE_E2E, "needs the services started by scripts/run-e2e.ps1");
test.describe.configure({ mode: "serial" });

const PASSWORD = "Correct-Horse-Battery-9";
const hash = () => { const salt = randomBytes(16); const key = scryptSync(PASSWORD.normalize("NFKC"), salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 2 ** 15 * 8 * 2 }); return `scrypt$${2 ** 15}$8$1$${salt.toString("base64")}$${key.toString("base64")}`; };
let azee: pg.Client, trade: pg.Client;
test.beforeAll(async () => {
  azee = new pg.Client({ connectionString: process.env.DATABASE_URL }); await azee.connect();
  const cfg = JSON.parse(fs.readFileSync(process.env.AZTRADE_CERT_CONFIG!, "utf8"));
  trade = new pg.Client({ connectionString: cfg.ownerUrl }); await trade.connect();
  await trade.query(`INSERT INTO market_data_sources (id, name, license_status, license_reference, allows_execution) VALUES ('e2e-fixture','E2E test fixture (not market data)','licensed','E2E-TEST-ONLY-NOT-A-REAL-LICENCE',true) ON CONFLICT (id) DO NOTHING`);
  await trade.query(`INSERT INTO instruments (symbol, name, type) VALUES ('ESYM1','E2E symbol','stock') ON CONFLICT (symbol) DO UPDATE SET active = true`);
});
test.afterAll(async () => { await azee?.end(); await trade?.end(); });

type U = { id: string; email: string; name: string };
async function newUser(name: string, plan?: string): Promise<U> {
  const id = `e2e-${randomUUID()}`, email = `${id}@example.test`;
  await azee.query("INSERT INTO users (id, email, name, email_verified_at) VALUES ($1,$2,$3,now())", [id, email, name]);
  await azee.query("INSERT INTO user_credentials (user_id, password_hash) VALUES ($1,$2)", [id, hash()]);
  if (plan) await setPlan(id, plan);
  return { id, email, name };
}
const setPlan = async (id: string, plan: string, status = "active") => {
  await azee.query("DELETE FROM subscriptions WHERE user_id=$1", [id]);
  await azee.query("INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_end) VALUES ($1,$2,$3,$4,now() + interval '30 days')", [randomUUID(), id, plan, status]);
};
async function signIn(page: Page, u: U) {
  await page.goto("/signin?next=/trade");
  await page.getByLabel("Email").fill(u.email); await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("user-name")).toHaveText(u.name, { timeout: 60_000 });
}
async function freshContext(browser: Browser) { const context = await browser.newContext(); const page = await context.newPage(); return { context, page }; }
const licensedQuote = async (price: string) => trade.query(`INSERT INTO market_prices (symbol, price, updated_at, provider_timestamp, source_id) VALUES ('ESYM1',$1::numeric,now(),now(),'e2e-fixture')
  ON CONFLICT (symbol) DO UPDATE SET price=EXCLUDED.price, updated_at=now(), provider_timestamp=now(), source_id='e2e-fixture'`, [price]);
const placeOrder = async (page: Page, side: string, shares: string, symbol = "ESYM1") => {
  await page.getByLabel("Symbol").fill(symbol); await page.getByLabel("Side").selectOption(side); await page.getByLabel("Shares").fill(shares);
  await page.getByRole("button", { name: "Place paper order" }).click();
};
let A: U, B: U;

test("signed-out visitors are sent to sign in, and the trade API refuses them", async ({ page }) => {
  await page.goto("/trade"); await expect(page).toHaveURL(/\/signin\?next=(%2F|\/)trade/);
  const r = await page.request.get("/api/trade/account"); expect(r.status()).toBe(401);
  expect((await page.request.get("/api/trade/me")).status()).toBe(401);
  expect((await page.request.post("/api/aztrade/token")).status()).toBe(403);      // no session and no same-origin proof
});

test("sign in: workspace shows the user, plan, paper-only notice, an honest no-market-data state and an untouched account", async ({ browser }) => {
  A = await newUser("Alice Tester");
  const { page, context } = await freshContext(browser); await signIn(page, A);
  await expect(page.getByTestId("plan-badge")).toContainText("Free");
  await expect(page.getByTestId("mode-note")).toContainText("Live trading is off");
  await expect(page.getByTestId("market-unavailable")).toBeVisible();
  await expect(page.getByTestId("cash")).toHaveText("$100,000.00");
  await expect(page.getByTestId("no-positions")).toBeVisible();
  await expect(page.getByTestId("ai-allowance")).toContainText("0 of 300 used");
  await expect(page.locator("body")).not.toContainText(/228\.45|67,420|581\.20/);     // none of the old hard-coded demo prices
  await context.close();
});

test("with no licensed price a paper order is refused clearly and nothing moves", async ({ browser }) => {
  const { page, context } = await freshContext(browser); await signIn(page, A);
  await placeOrder(page, "BUY", "2");
  await expect(page.getByTestId("order-notice")).toBeVisible();
  await expect(page.getByTestId("order-notice")).not.toContainText("filled");
  await expect(page.getByTestId("cash")).toHaveText("$100,000.00"); await expect(page.getByTestId("no-orders")).toBeVisible();
  await context.close();
});

test("a licensed price appears with its source; a paper order fills; the account reflects it exactly", async ({ browser }) => {
  await licensedQuote("10");
  const { page, context } = await freshContext(browser); await signIn(page, A);
  await expect(page.getByTestId("quote-ESYM1")).toContainText("E2E test fixture");
  await expect(page.getByTestId("quote-ESYM1")).toContainText("$10.00");
  await placeOrder(page, "BUY", "2");
  await expect(page.getByTestId("order-notice")).toHaveText("Paper order filled.");
  await expect(page.getByTestId("cash")).toHaveText("$99,980.00");
  await expect(page.getByTestId("positions")).toContainText("ESYM1: 2");
  await expect(page.getByTestId("orders")).toContainText("BUY 2 ESYM1");
  await context.close();
});

test("a lost response never causes a second order: the retry reuses the same key and is reported as already placed", async ({ browser }) => {
  const { page, context } = await freshContext(browser); await signIn(page, A);
  let cut = true;
  await page.route("**/api/trade/orders", async route => { if (cut) { cut = false; await route.fetch(); await route.abort("connectionreset"); } else await route.continue(); });
  await placeOrder(page, "BUY", "1");                                              // the server fills it, the browser never sees the answer
  await expect(page.getByTestId("order-notice")).toContainText("Network problem");
  await page.getByRole("button", { name: "Place paper order" }).click();            // retry: same form, same key
  await expect(page.getByTestId("order-notice")).toContainText("already placed");
  await expect(page.getByTestId("cash")).toHaveText("$99,970.00");                  // charged once: 2 + 1 shares at $10
  await expect(page.getByTestId("orders").locator("li")).toHaveCount(2);
  await context.close();
});

test("insufficient cash and unknown symbols are refused with the server's reason and change nothing", async ({ browser }) => {
  const { page, context } = await freshContext(browser); await signIn(page, A);
  await placeOrder(page, "BUY", "20000"); await expect(page.getByTestId("order-notice")).toContainText(/cash|insufficient|funds/i);
  await placeOrder(page, "BUY", "1", "NOPE"); await expect(page.getByTestId("order-notice")).toBeVisible();
  await expect(page.getByTestId("cash")).toHaveText("$99,970.00");
  await context.close();
});

test("AI: answers from the real pipeline, shows usage, persists across reloads, and cannot place orders", async ({ browser }) => {
  const { page, context } = await freshContext(browser); await signIn(page, A);
  await page.getByLabel("Ask the assistant").fill("How is my account doing?"); await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("messages")).toContainText("explicit demo response", { timeout: 60_000 });
  await expect(page.getByTestId("ai-allowance")).toContainText("1 of 300 used");
  await page.getByLabel("Ask the assistant").fill("Buy 500 shares of ESYM1 right now"); await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("ai-allowance")).toContainText("2 of 300 used");
  await expect(page.getByTestId("cash")).toHaveText("$99,970.00");                  // the assistant has no execution path
  await expect(page.getByTestId("orders").locator("li")).toHaveCount(2);
  await page.reload(); await expect(page.getByTestId("messages")).toContainText("Buy 500 shares");
  await context.close();
});

test("AI allowance: when the monthly allowance is used the user is told, the counter holds, and nothing is charged beyond it", async ({ browser }) => {
  const free = await azee.query("SELECT monthly_limit FROM plan_entitlements WHERE plan_id='free' AND feature='messages'"); const original = free.rows[0].monthly_limit;
  await azee.query("UPDATE plan_entitlements SET monthly_limit=3 WHERE plan_id='free' AND feature='messages'");
  try {
    const { page, context } = await freshContext(browser); await signIn(page, A);       // 2 of 3 already used above
    await expect(page.getByTestId("ai-allowance")).toContainText("2 of 3 used");
    await page.getByLabel("Ask the assistant").fill("third question"); await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("ai-allowance")).toContainText("3 of 3 used");
    await page.getByLabel("Ask the assistant").fill("fourth question"); await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("ai-notice")).toContainText("used up");
    await expect(page.getByTestId("ai-allowance")).toContainText("3 of 3 used");
    await context.close();
  } finally { await azee.query("UPDATE plan_entitlements SET monthly_limit=$1 WHERE plan_id='free' AND feature='messages'", [original]); }
});

test("permission denial and plan changes: Free is refused the Plus feature; upgrading allows it on reload; downgrading denies it again", async ({ browser }) => {
  const { page, context } = await freshContext(browser); await signIn(page, A);
  const run = async () => { await page.getByRole("button", { name: /Run momentum backtest/ }).click(); };
  await run(); await expect(page.getByTestId("backtest-result")).toContainText("Plus plan or higher");
  await setPlan(A.id, "plus"); await page.reload();
  await expect(page.getByTestId("plan-badge")).toContainText(/Plus/i);
  await run(); await expect(page.getByTestId("backtest-result")).toContainText("Simulated illustration, not market data");
  await setPlan(A.id, "plus", "canceled"); await page.reload();                      // lapse
  await expect(page.getByTestId("plan-badge")).toContainText("Free");
  await run(); await expect(page.getByTestId("backtest-result")).toContainText("Plus plan or higher");
  await setPlan(A.id, "pro25"); await page.reload(); await expect(page.getByTestId("plan-badge")).toContainText("premium");
  await run(); await expect(page.getByTestId("backtest-result")).toContainText("Simulated illustration");
  await setPlan(A.id, "go"); await page.reload(); await expect(page.getByTestId("plan-badge")).toContainText("plus");
  await context.close();
});

test("the browser never holds an AZTrade token or a prohibited path: no Authorization header, no JWT in storage or page, unlisted API paths are 404", async ({ browser }) => {
  const { page, context } = await freshContext(browser); const seen: { url: string; auth: string | undefined }[] = [];
  page.on("request", r => { if (r.url().includes("/api/")) seen.push({ url: r.url(), auth: r.headers()["authorization"] }); });
  await signIn(page, A); await page.reload(); await expect(page.getByTestId("cash")).toBeVisible();
  expect(seen.length).toBeGreaterThan(3); expect(seen.filter(r => r.auth)).toEqual([]);
  expect(seen.some(r => /:3101|\/api\/(paper|assistant|markets|portfolio)\//.test(r.url))).toBe(false);   // nothing talks to the AZTrade API directly
  const leak = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, d: document.documentElement.outerHTML }));
  expect(leak).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./);
  for (const p of ["portfolio", "risk", "admin", "account/../portfolio", "markets/AAPL"]) expect((await page.request.get(`/api/trade/${p}`)).status(), p).toBe(404);
  expect((await page.request.post("/api/trade/orders", { data: {}, headers: { origin: "http://evil.example" } })).status()).toBe(403);   // cross-site writes refused
  await context.close();
});

test("tenant switching: signing out and in as another user shows none of the first user's data, in the same browser", async ({ browser }) => {
  B = await newUser("Bob Tester");
  const { page, context } = await freshContext(browser); await signIn(page, A);
  await expect(page.getByTestId("positions")).toContainText("ESYM1");
  await page.getByRole("button", { name: "Sign out" }).click(); await expect(page).toHaveURL(/\/signin/);
  await page.goto("/trade"); await expect(page).toHaveURL(/\/signin/);              // really signed out
  await signIn(page, B);
  await expect(page.getByTestId("user-name")).toHaveText("Bob Tester");
  await expect(page.getByTestId("cash")).toHaveText("$100,000.00");
  await expect(page.getByTestId("no-positions")).toBeVisible(); await expect(page.getByTestId("no-orders")).toBeVisible();
  await expect(page.getByTestId("ai-allowance")).toContainText("0 of");
  await expect(page.getByTestId("account-panel")).not.toContainText("ESYM1");                  // shared licensed quotes may show in the market panel; Alice's holdings and orders may not\n  await expect(page.getByTestId("assistant-panel")).not.toContainText(/Buy 500|How is my account/);
  expect(await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter(k => /aztrade|portfolio|paper|chat/i.test(k)))).toEqual([]);
  await context.close();
});

test("sessions that end elsewhere stop working at once: revoked, expired, and signed out in another tab", async ({ browser }) => {
  for (const how of ["revoked", "expired"] as const) {
    const u = await newUser(`Session ${how}`); const { page, context } = await freshContext(browser); await signIn(page, u);
    await azee.query(how === "revoked" ? "UPDATE user_sessions SET revoked_at = now() WHERE user_id=$1" : "UPDATE user_sessions SET expires_at = now() - interval '1 second' WHERE user_id=$1", [u.id]);
    await page.getByLabel("Ask the assistant").fill("still there?"); await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("session-expired")).toBeVisible();
    await page.goto("/trade"); await expect(page).toHaveURL(/\/signin/);
    await context.close();
  }
  const u = await newUser("Two tabs"); const { page, context } = await freshContext(browser); await signIn(page, u);
  const other = await context.newPage(); await other.goto("/trade"); await other.getByRole("button", { name: "Sign out" }).click(); await expect(other).toHaveURL(/\/signin/);
  await page.getByRole("button", { name: /Run momentum backtest/ }).click(); await expect(page.getByTestId("session-expired")).toBeVisible();
  await context.close();
});
