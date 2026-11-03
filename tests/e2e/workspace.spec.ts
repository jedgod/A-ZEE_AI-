import { expect, test } from "@playwright/test";

// These tests cover the browser-only sidebar, so the account sidebar API answers 401 here and no
// test writes to the real account. Server mode: sidebar-server.spec.ts (mocked API) and
// scripts/check-sidebar.cjs (real API and database).
test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/(sidebar|projects|chats)(\/|\?|$)/, route => route.fulfill({ status: 401, json: { error: "SIGN_IN_REQUIRED" } }));
});

test("workspace renders safe Markdown, persists history and theme, and restores failed attachments", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /What’s on your mind/ })).toBeVisible();
  await page.route("**/api/chat/stream", route => route.fulfill({ json: { data: { answer: '## Verified answer\n\n- First item\n- Second item\n\n```html\n<img src=x onerror=alert(1)>\n```\n\n<script>alert(1)</script>' } } }));
  await page.getByRole("textbox").fill('Explain <img src=x onerror=alert(1)>');
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verified answer" })).toBeVisible();
  await expect(page.locator('article li')).toHaveCount(2);
  await expect(page.locator('article img')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('workspace-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  const theme = await page.locator('html').getAttribute('data-theme');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme!);
  await page.locator('aside').getByRole('button', { name: /^Explain <img(?!.* options$)/ }).click();
  await expect(page.getByRole('heading', { name: 'Verified answer' })).toBeVisible();
  await page.locator('aside').getByRole('button', { name: 'Chat', exact: true }).click();
  await page.route('**/api/chat/stream', route => route.fulfill({ status: 502, json: { error: 'AI_PROVIDER_UNAVAILABLE' } }));
  await page.locator('input[type=file]').setInputFiles({ name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('Attachment content') });
  await page.getByRole('textbox').fill('Summarize this');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('AI providers are unavailable');
  await expect(page.getByRole('textbox')).toHaveValue('Summarize this');
  await expect(page.getByText('Attached: sample.txt', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile workspace fits the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('textbox')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('aside').getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
  await expect(page.locator('aside')).toHaveCSS('left', '0px');
  await page.getByRole('button', { name: 'Menu', exact: true }).click({ timeout: 5000 });
  await expect(page.locator('aside').getByRole('button', { name: 'Chat', exact: true })).not.toBeInViewport();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('aside')).toHaveCSS('left', '0px');
  await page.mouse.click(350, 500);
  await expect(page.locator('aside').getByRole('button', { name: 'Chat', exact: true })).not.toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('workspace-mobile.png'), fullPage: true });
});

test("sidebar collapses and workspace menu previews prompts and uploads in the canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator("aside")).toHaveCSS("width", "64px");
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  const switcher = page.getByRole("button", { name: "Local workspace menu" });
  const menu = page.locator("#workspace-menu");
  const canvas = page.getByRole("dialog", { name: "Development canvas" });
  await switcher.click();
  await menu.getByRole("button", { name: "Turn an idea into working code" }).click();
  await expect(menu).toBeHidden();
  await expect(canvas).toContainText("Turn an idea into working code");
  await expect(page.frameLocator('iframe[title="Item preview"]').locator("pre")).toContainText("Help me build a web application");
  await canvas.getByRole("button", { name: "Use prompt" }).click();
  await expect(canvas).toBeHidden();
  await expect(page.getByRole("textbox")).toHaveValue(/Help me build a web application/);
  await expect(page.getByRole("button", { name: "Build with code" })).toHaveAttribute("aria-pressed", "true");

  await page.locator("input[type=file]").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle id="dot" cx="50" cy="50" r="40" fill="#10b981"/></svg>') });
  await page.getByRole("button", { name: "Remove" }).click();
  await switcher.click();
  await menu.getByRole("button", { name: "logo.svg" }).click();
  await expect(page.frameLocator('iframe[title="Item preview"]').locator("#dot")).toBeAttached();
  await canvas.getByRole("button", { name: "Attach to message" }).click();
  await expect(page.getByText("Attached: logo.svg")).toBeVisible();

  await page.getByRole("textbox").fill("My saved prompt");
  await switcher.click();
  // + New prompt opens a form prefilled from the composer; saving adds it to the menu.
  await page.getByRole("button", { name: "+ New prompt" }).click();
  await expect(menu).toBeHidden();
  const promptForm = page.getByRole("dialog", { name: "New prompt" });
  await expect(promptForm.getByLabel("Prompt")).toHaveValue("My saved prompt");
  await expect(promptForm.getByLabel("Title")).toHaveValue("My saved prompt");
  await promptForm.getByRole("button", { name: "Save prompt" }).click();
  await expect(promptForm).toBeHidden();
  await switcher.click();
  await expect(menu.getByRole("button", { name: "My saved prompt" })).toBeVisible();
  // Writing one from scratch: empty prompt is refused; title defaults to the first words.
  await menu.getByRole("button", { name: "+ New prompt" }).click();
  await page.getByRole("textbox").first().fill("");
  await promptForm.getByLabel("Prompt").fill("");
  await promptForm.getByRole("button", { name: "Save prompt" }).click();
  await expect(promptForm.getByRole("alert")).toHaveText("Write the prompt first.");
  await promptForm.getByLabel("Prompt").fill("Review this code for security issues");
  await promptForm.getByLabel("Title").fill("");
  await promptForm.getByLabel("Mode").selectOption("code");
  await promptForm.getByRole("button", { name: "Save prompt" }).click();
  await switcher.click();
  await menu.getByRole("button", { name: "Review this code for security issues" }).click();
  await expect(canvas).toContainText("Review this code for security issues");
  await canvas.getByRole("button", { name: "Use prompt" }).click();
  await expect(page.getByRole("button", { name: "Build with code" })).toHaveAttribute("aria-pressed", "true");
});

test("local workspace menu opens on hover and pins on click, expanded or collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.locator('nav[aria-label="Quick actions"] button')).toHaveCount(3);
  const switcher = page.getByRole("button", { name: "Local workspace menu" });
  const menu = page.locator("#workspace-menu");
  await switcher.hover();
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Local workspace");
  await menu.getByText("Prompts").hover();
  await expect(menu).toBeVisible();
  await page.mouse.move(900, 600);
  await expect(menu).toBeHidden();
  await switcher.click();
  await expect(menu).toBeVisible();
  await page.mouse.move(900, 600);
  await page.waitForTimeout(300);
  await expect(menu).toBeVisible();
  await switcher.click();
  await expect(menu).toBeHidden();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await switcher.hover();
  await expect(menu).toBeVisible();
  await switcher.click();
  await page.mouse.move(900, 600);
  await page.waitForTimeout(300);
  await expect(menu).toBeVisible();
  await page.mouse.click(900, 600);
  await expect(menu).toBeHidden();
});

test("local workspace toggle opens the development canvas preview", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.route("**/api/chat/stream", route => route.fulfill({ json: { data: { answer:
    "Here is a card:\n\n```html\n<button id=\"go\">Go</button><form id=\"f\"><button id=\"s\">Send</button></form>\n```\n\n```css\n#go { color: rgb(255, 0, 0); }\n```\n\n```js\ndocument.getElementById('go').textContent = 'Ready';\nfetch('https://example.com').catch(() => document.body.dataset.blocked = 'yes');\ndocument.getElementById('f').addEventListener('submit', e => { e.preventDefault(); document.getElementById('s').textContent = 'Submitted'; });\n```" } } }));
  const toggle = page.getByRole("button", { name: "Local workspace", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const canvas = page.getByRole("dialog", { name: "Development canvas" });
  await expect(canvas).toContainText("Preview area for the project");
  await page.keyboard.press("Escape");
  await expect(canvas).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("textbox").fill("Build a card");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(2);
  await toggle.click();
  await expect(canvas.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts allow-forms");
  const preview = page.frameLocator('iframe[title="Project preview"]');
  await expect(preview.locator("#go")).toHaveText("Ready");
  await expect(preview.locator("#go")).toHaveCSS("color", "rgb(255, 0, 0)");
  await expect(preview.locator("body")).toHaveAttribute("data-blocked", "yes");
  await preview.locator("#s").click();
  await expect(preview.locator("#s")).toHaveText("Submitted");
  await canvas.getByRole("tab", { name: "Code (3)" }).click();
  await expect(canvas.locator("figure")).toHaveCount(3);
  await canvas.getByRole("button", { name: "Close canvas" }).click();
  await expect(canvas).toBeHidden();
});

test("share menu copies a working project link and validates emails", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const share = page.getByRole("button", { name: "Share project" });
  await share.click();
  const menu = page.locator("#share-menu");
  await expect(menu.getByRole("menuitem")).toHaveText([/Anyone with the link.*project, instructions, and files/, "Specific emails", "More…"]);
  await menu.getByRole("menuitem", { name: /Anyone with the link/ }).click();
  await expect(page.getByText("Start a conversation to share it.")).toBeVisible();

  await page.route("**/api/chat/stream", route => route.fulfill({ json: { data: { answer: "## Shared answer" } } }));
  await page.locator("input[type=file]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("File body") });
  await page.getByRole("textbox").fill("Plan the project");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shared answer" })).toBeVisible();

  await share.click();
  await menu.getByRole("menuitem", { name: "Specific emails" }).click();
  await menu.getByLabel("People to send the project link to").fill("friend@example.com, not-an-email");
  await menu.getByRole("button", { name: "Create email" }).click();
  await expect(menu.getByRole("alert")).toHaveText("Check not-an-email");
  await menu.getByRole("button", { name: "Back" }).click();
  await menu.getByRole("menuitem", { name: "More…" }).click();
  await expect(menu.getByRole("menuitem", { name: "Download as Markdown" })).toBeVisible();
  await menu.getByRole("button", { name: "Back" }).click();
  await menu.getByRole("menuitem", { name: /Anyone with the link/ }).click();
  await expect(menu).toBeHidden();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/^http:\/\/localhost:3000\/#share=[\w-]+$/);

  const viewer = await context.newPage();
  await viewer.goto(link);
  await expect(viewer.getByRole("heading", { name: "Shared answer" })).toBeVisible();
  await expect(viewer.locator("article").first()).toContainText("[Attached: notes.txt]");
  await expect(viewer.getByRole("status")).toContainText("Opened shared project “Plan the project”");
  expect(new URL(viewer.url()).hash).toBe("");
  await viewer.getByRole("button", { name: "Local workspace menu" }).click();
  await expect(viewer.locator("#workspace-menu").getByRole("button", { name: "notes.txt" })).toBeVisible();
});

test("more menu moves the chat between projects and deletes it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Local workspace", exact: true });
  await expect(toggle).toHaveText("[]");
  const more = page.getByRole("button", { name: "More options" });
  const menu = page.locator("#more-menu");
  await more.click();
  await expect(menu.getByRole("menuitem", { name: /Move project/ })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "Delete chat" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.route("**/api/chat/stream", route => route.fulfill({ json: { data: { answer: "Sure." } } }));
  await page.getByRole("textbox").fill("Plan the launch");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(2);
  await expect(page.locator("header")).toContainText("General");

  await more.click();
  await expect(menu).toContainText("Now in General");
  await menu.getByRole("menuitem", { name: /Move project/ }).click();
  await expect(menu.getByRole("menuitemradio", { name: "General" })).toHaveAttribute("aria-checked", "true");
  await menu.getByLabel("New project name").fill("Client site");
  await menu.getByRole("button", { name: "Create & move" }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByText("Moved to Client site")).toBeVisible();
  await expect(page.locator("header")).toContainText("Client site");
  // Sidebar: the new project is listed under Projects; expanding it shows its chat.
  const sidebar = page.locator("aside");
  const clientSite = sidebar.getByRole("group", { name: "Projects" }).getByRole("button", { name: "Client site", exact: true });
  await expect(clientSite).toBeVisible();
  await clientSite.click();
  await expect(clientSite).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByRole("group", { name: "Client site chats" }).getByRole("button", { name: "Plan the launch", exact: true })).toBeVisible();

  await page.reload();
  await page.locator("aside").getByRole("button", { name: "Plan the launch", exact: true }).click();
  await expect(page.locator("header")).toContainText("Client site");
  await more.click();
  await menu.getByRole("menuitem", { name: /Move project/ }).click();
  await expect(menu.getByRole("menuitemradio")).toHaveText(["General", "Client site"]);
  await expect(menu.getByRole("menuitemradio", { name: "Client site" })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: "General" }).click();
  // Back in General: it's listed under Chats (chats in no project), no longer under Client site.
  await expect(page.locator("aside").getByRole("group", { name: "Chats" }).getByRole("button", { name: "Plan the launch", exact: true })).toBeVisible();
  await expect(page.locator("aside").getByRole("group", { name: "Client site chats" }).getByText("No chats yet")).toBeVisible();

  await more.click();
  await menu.getByRole("menuitem", { name: "Delete chat" }).click();
  await expect(menu).toContainText("“Plan the launch” will be removed from this browser");
  await menu.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("article")).toHaveCount(2);
  await menu.getByRole("menuitem", { name: "Delete chat" }).click();
  await menu.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Chat deleted")).toBeVisible();
  await expect(page.locator("article")).toHaveCount(0);
  await expect(page.locator("aside").getByRole("button", { name: "Plan the launch", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator("aside").getByRole("button", { name: "Plan the launch", exact: true })).toHaveCount(0);
});

test("answers can be rated and corrected, and insights load", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const requestId = "0b6f2a4e-8c1d-4f3a-9e2b-5d7c1a3f4e6b";
  await page.route("**/api/chat/stream", route => route.fulfill({ json: { data: { answer: "Paris is the capital.", pipeline: { requestId, redacted: {} } } } }));
  const sentFeedback: unknown[] = [];
  await page.route("**/api/feedback", async route => { sentFeedback.push(route.request().postDataJSON()); await route.fulfill({ status: 201, json: { data: { saved: true } } }); });
  await page.getByRole("textbox").fill("Capital of France?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Paris is the capital.")).toBeVisible();
  await page.getByRole("button", { name: "Not helpful" }).click();
  await expect(page.getByRole("button", { name: "Not helpful" })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("What should the answer have said? (optional)").fill("It should mention the population too.");
  await page.getByRole("button", { name: "Send correction" }).click();
  await expect(page.getByText("Thanks, correction saved.")).toBeVisible();
  expect(sentFeedback).toEqual([{ requestId, rating: 1 }, { requestId, correction: "It should mention the population too." }]);

  await page.getByRole("link", { name: "Insights" }).click();
  await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible();
});

test("account menu, pricing page, research plan and translation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const menu = page.getByRole("button", { name: /^Account menu for / });
  await expect(menu).toContainText("IPMC BIT");
  await expect(menu).toContainText("Plus");
  await menu.click();
  await page.getByRole("menuitem", { name: "Help" }).hover();
  await expect(page.getByRole("menuitem", { name: "Report a bug" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+/");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");

  const requestId = "1b6f2a4e-8c1d-4f3a-9e2b-5d7c1a3f4e6c";
  await page.route("**/api/chat/stream", route => route.fulfill({ json: { data: { answer: "Use a spreadsheet first.", pipeline: { requestId, redacted: {}, plan: ["List needs", "Compare tools"], warnings: [] } } } }));
  await page.route("**/api/translate", route => route.fulfill({ json: { data: { text: "Usa primero una hoja de cálculo.", language: "es" } } }));
  await page.getByRole("button", { name: "Explore deeply" }).click();
  await page.getByRole("textbox").fill("Spreadsheet or database?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Research plan · 2 steps")).toBeVisible();
  await page.getByLabel("Translate answer").selectOption("es");
  await expect(page.getByLabel("Translation")).toContainText("Usa primero una hoja de cálculo.");

  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Pricing" })).toBeVisible();
  await expect(page.getByText("Pro 25", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Plus.*Current/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Your plan" })).toBeDisabled();
  await page.getByRole("tab", { name: /Annual/ }).click();
  await expect(page.getByText("$149.90").first()).toBeVisible();
});

test("streamed answer shows tool status, validated text, sources and tone", async ({ page }) => {
  const requestId = "7d4f5a2e-1b3c-4d5e-8f90-123456789abc";
  let sent: Record<string, unknown> = {};
  await page.route("**/api/chat/stream", async route => {
    sent = JSON.parse(route.request().postData() || "{}");
    const frames = [
      ["status", { stage: "tools" }], ["tool", { name: "calculator", status: "complete" }],
      ["delta", { text: "12 × 7 = 84, per " }], ["delta", { text: "[web:1]." }],
      ["final", { pipeline: { requestId, redacted: {}, warnings: [], sources: [{ id: "web:1", title: "Times tables", url: "https://example.org/tables" }] } }],
    ].map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: frames });
  });
  await page.goto("/");
  // Wait for hydration (the account loads client-side) so React doesn't reset the select.
  await expect(page.locator("aside")).toContainText("IPMC BIT");
  await page.getByLabel("Answer tone", { exact: true }).selectOption("technical");
  await expect(page.getByLabel("Answer tone", { exact: true })).toHaveValue("technical");
  await page.getByRole("textbox").fill("What is 12 * 7?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator("article").last()).toContainText("12 × 7 = 84");
  const source = page.getByRole("navigation", { name: "Sources" }).getByRole("link");
  await expect(source).toHaveText("[1] Times tables ↗");
  await expect(source).toHaveAttribute("href", "https://example.org/tables");
  expect(sent.style).toBe("technical");
});

test("sidebar groups: main, projects with More, chats, plugins; collapsed shows icons only", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const projects = Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `Project ${i + 1}` }));
    localStorage.setItem("az-projects", JSON.stringify(projects));
    localStorage.setItem("az-user-conversations", JSON.stringify([
      { id: "c1", title: "Budget plan", mode: "chat", projectId: "p6", messages: [{ role: "user", content: "Budget plan" }, { role: "assistant", content: "Here is a plan." }] },
      { id: "c2", title: "Hash maps", mode: "code", messages: [{ role: "user", content: "Hash maps" }, { role: "assistant", content: "A hash map..." }] },
    ]));
  });
  await page.goto("/");
  const sidebar = page.locator("aside");
  const main = sidebar.getByRole("group", { name: "main" });
  await expect(main.getByRole("button")).toHaveText(["Chat", "Research", "Code workspaceDEV", "Library"]);
  await expect(main.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-current", "page");

  // Projects: a folder tree (General isn't listed: its chats are under Chats); 5 shown until More.
  const projects = sidebar.getByRole("group", { name: "Projects" });
  await expect(projects.getByRole("button", { name: /^Project \d$/ })).toHaveCount(5);
  await projects.getByRole("button", { name: "More" }).click();
  await expect(projects.getByRole("button", { name: /^Project \d$/ })).toHaveCount(6);
  await projects.getByRole("button", { name: "Projects" }).click();
  await expect(projects.getByRole("button", { name: "Project 1", exact: true })).toHaveCount(0);
  await projects.getByRole("button", { name: "Projects" }).click();

  // Chats lists chats in no project; a project expands (open folder) to show its own chats.
  const chatNames = /^(Budget plan|Hash maps)$/;
  await expect(sidebar.getByRole("group", { name: "Chats" }).getByRole("button", { name: chatNames })).toHaveText(["Hash maps"]);
  const project6 = projects.getByRole("button", { name: "Project 6", exact: true });
  await project6.click();
  await expect(project6).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByRole("group", { name: "Project 6 chats" }).getByRole("button", { name: chatNames })).toHaveText(["Budget plan"]);

  // "+" on a project starts a new chat inside it.
  await sidebar.getByRole("button", { name: "New chat in Project 6" }).click();
  await expect(page.locator("header")).toContainText("Project 6");
  await project6.click();
  await expect(sidebar.getByRole("group", { name: "Project 6 chats" })).toHaveCount(0);

  await sidebar.getByRole("group", { name: "Chats" }).getByRole("button", { name: "Hash maps", exact: true }).click();
  await expect(page.locator("article").last()).toContainText("A hash map");
  await expect(sidebar.getByRole("button", { name: "Hash maps", exact: true })).toHaveAttribute("aria-current", "page");

  // Chat starts a fresh conversation in chat mode (there is no separate "New conversation" button).
  await expect(sidebar.getByRole("button", { name: "New conversation" })).toHaveCount(0);
  await main.getByRole("button", { name: "Chat" }).click();
  await expect(page.locator("article")).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Ask anything" })).toHaveAttribute("aria-pressed", "true");

  // Library opens the workspace menu (prompts and uploads); Research switches mode.
  await main.getByRole("button", { name: "Library" }).click();
  await expect(page.locator("#workspace-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await main.getByRole("button", { name: "Chat" }).click();
  await main.getByRole("button", { name: "Research" }).click();
  await expect(page.getByRole("button", { name: "Explore deeply" })).toHaveAttribute("aria-pressed", "true");

  // Plugins opens the connectors catalog (Skills tab links on to the governed extensions).
  await expect(sidebar.getByRole("link", { name: "Plugins" })).toHaveAttribute("href", "/connectors");

  // A long chat list scrolls between the main items and Plugins, fading out at the bottom.
  await page.evaluate(() => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `long-${i}`, title: `Chat number ${i}`, mode: "chat", messages: [{ role: "user", content: "x" }, { role: "assistant", content: "y" }] }));
    localStorage.setItem("az-user-conversations", JSON.stringify(many));
  });
  await page.reload();
  const scroller = page.locator("aside [data-more]");
  await expect(scroller).toHaveCount(1);
  await expect(sidebar.getByRole("link", { name: "Plugins" })).toBeInViewport();
  await scroller.evaluate(el => el.scrollTo(0, el.scrollHeight));
  await expect(page.locator("aside [data-more]")).toHaveCount(0);

  // Collapsed: icons with accessible names; long lists hidden.
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar.getByRole("button", { name: "Research" })).toBeVisible();
  await expect(sidebar.getByRole("group", { name: /Chats/ })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Plugins" })).toBeVisible();

  await page.goto("/extensions");
  await expect(page.getByText("Plugins are managed by staff administrators.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Staff sign-in" })).toHaveAttribute("href", "/login?next=/extensions");
});

test("local workspace menu: no gap, active state, header, quick actions, keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.locator("aside")).toContainText("IPMC BIT");
  const switcher = page.getByRole("button", { name: "Local workspace menu" });
  const menu = page.locator("#workspace-menu");

  // Opens directly under the button (4px), and the pointer can travel into it without closing it.
  await switcher.hover();
  await expect(menu).toBeVisible();
  const b = (await switcher.boundingBox())!, m = (await menu.boundingBox())!;
  expect(Math.round(m.y - (b.y + b.height))).toBeLessThanOrEqual(4);
  await page.mouse.move(b.x + 30, m.y + 20, { steps: 10 });
  await page.waitForTimeout(300);
  await expect(menu).toBeVisible();
  await page.mouse.move(900, 600);
  await expect(menu).toBeHidden();

  // Active state, header with the account, plan and status, quick actions.
  await switcher.click();
  await expect(switcher).toHaveAttribute("aria-expanded", "true");
  await expect(switcher).toHaveCSS("color", "rgb(6, 95, 70)");
  await expect(menu).toContainText("IPMC BIT · Plus");
  await expect(menu).toContainText("Active");
  await expect(menu.getByRole("link", { name: "Insights" })).toHaveAttribute("href", "/insights");
  await menu.getByRole("button", { name: "New project" }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
  await page.keyboard.press("Escape");
  await switcher.click();
  // Settings: real workspace settings (theme, default tone, sidebar, export, clear).
  await menu.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog").filter({ hasText: "Workspace settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settings.getByLabel("Default answer tone").selectOption("technical");
  await expect(page.getByLabel("Answer tone", { exact: true })).toHaveValue("technical");
  await settings.getByRole("group", { name: "Sidebar" }).getByRole("button", { name: "Collapsed" }).click();
  await expect(page.locator("aside")).toHaveCSS("width", "64px");
  await settings.getByRole("group", { name: "Sidebar" }).getByRole("button", { name: "Expanded" }).click();
  await settings.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Light" }).click();
  await settings.getByRole("button", { name: "Clear…" }).click();
  await expect(page.getByRole("dialog").filter({ hasText: "Your data" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  // The rail's ⚙ opens the same settings.
  await page.getByRole("button", { name: "Workspace settings" }).click();
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();

  // Keyboard: ↓ opens and focuses the first item, ↑ wraps to the last, Escape closes and refocuses the switcher.
  await switcher.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "New chat" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("button", { name: "New project" })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("button", { name: "+ New prompt" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(switcher).toBeFocused();
});
