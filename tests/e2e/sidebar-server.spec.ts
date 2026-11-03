import { expect, test, type Page, type Route } from "@playwright/test";

// The workspace sidebar in server mode, against an in-memory mock of /api/sidebar, /api/projects
// and /api/chats (the real API and database are covered by scripts/check-sidebar.cjs).

type Project = { id: string; name: string; description?: string; instructions?: string; defaultMode?: string };
type Chat = { id: string; title: string; projectId: string | null; pinned: boolean; mode: string; messages?: unknown[] };
const PROJECT_CHAT_LIMIT = 3;   // the mock lists 3 chats per project, so "Show all" appears
const GENERAL = "general";

function mockApi(page: Page) {
  const db = { projects: [] as Project[], chats: [] as Chat[], calls: [] as { method: string; url: string; body: unknown }[] };
  const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, json: data === undefined ? {} : { data } });
  const chatItem = (c: Chat) => ({ id: c.id, label: c.title, icon: c.pinned ? "pin" : "message", type: "chat", pinned: c.pinned, actions: ["new-tab", "rename", "pin", "delete"] });
  const byPin = (list: Chat[]) => [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  // Same shape as lib/sidebar.ts: projects carry their chats; Chats lists chats in no project.
  const groups = (url: URL) => [
    { id: "main", collapsible: false, items: [
      { id: "chat", label: "Chat", icon: "chat" }, { id: "research", label: "Research", icon: "search" },
      { id: "code", label: "Code workspace", icon: "code", badge: "DEV" }, { id: "library", label: "Library", icon: "library" }] },
    { id: "projects", label: "Projects", collapsible: true, actions: ["all", "add"], total: db.projects.length,
      items: db.projects.map(p => {
        const all = byPin(db.chats.filter(c => c.projectId === p.id));
        const children = all.slice(0, PROJECT_CHAT_LIMIT);
        return { id: p.id, label: p.name, icon: "folder", type: "project", actions: ["new-chat", "rename", "share", "edit", "settings", "delete"],
          ...(p.description ? { description: p.description } : {}), mode: p.defaultMode ?? "chat", children: children.map(chatItem), childCount: all.length };
      }) },
    { id: "chats", label: "Chats", collapsible: true, actions: ["see-all"],
      items: byPin(db.chats.filter(c => c.projectId === null)).slice(0, url.searchParams.get("chats") === "all" ? 200 : 8).map(chatItem) },
    { id: "plugins", collapsible: false, items: [{ id: "plugins", label: "Plugins", icon: "puzzle", href: "/extensions" }] },
  ];
  // Context-wide, so a tab opened with "Open in new tab" also uses the mock.
  return page.context().route(/\/api\/(sidebar|projects|chats)(\/|\?|$)/, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    db.calls.push({ method: request.method(), url: url.pathname + url.search, body });
    const [, , kind, id] = url.pathname.split("/");
    if (kind === "sidebar" && id === "import") {
      for (const p of body.projects) db.projects.push(p);
      for (const c of body.chats) db.chats.push({ id: c.id, title: c.title, projectId: c.projectId ?? null, pinned: false, mode: c.mode ?? "chat", messages: c.messages ?? [] });
      return json(route, { projectsAdded: body.projects.length, chatsAdded: body.chats.length, projectIds: Object.fromEntries(body.projects.map((p: Project) => [p.id, p.id])) });
    }
    if (kind === "sidebar") return json(route, groups(url));
    if (kind === "projects" && !id) {
      if (request.method() === "GET") return json(route, db.projects);
      if (db.projects.some(p => p.name.toLowerCase() === body.name.toLowerCase())) return json(route, db.projects.find(p => p.name.toLowerCase() === body.name.toLowerCase()));
      const project = { id: body.id ?? crypto.randomUUID(), name: body.name };
      db.projects.push(project);
      return json(route, project, 201);
    }
    if (kind === "projects") {
      if (request.method() === "DELETE") {
        db.projects = db.projects.filter(p => p.id !== id);
        db.chats.forEach(c => { if (c.projectId === id) c.projectId = null; });
        return route.fulfill({ status: 204 });
      }
      const project = db.projects.find(p => p.id === id)!;
      const details = () => ({ id, name: project.name, description: project.description ?? "", instructions: project.instructions ?? "", defaultMode: project.defaultMode ?? "chat" });
      if (request.method() === "GET") return json(route, details());
      if (body.name && db.projects.some(p => p.id !== id && p.name.toLowerCase() === body.name.toLowerCase())) return route.fulfill({ status: 409, json: { error: "PROJECT_EXISTS" } });
      Object.assign(project, body);
      return json(route, details());
    }
    if (kind === "chats" && !id) {
      const projectId = url.searchParams.get("projectId");
      return json(route, byPin(db.chats.filter(c => !projectId || (projectId === GENERAL ? c.projectId === null : c.projectId === projectId)))
        .map(c => ({ id: c.id, title: c.title, projectId: c.projectId, pinned: c.pinned, mode: c.mode, messageCount: c.messages?.length ?? 0, updatedAt: "" })));
    }
    if (kind === "chats") {
      const chat = db.chats.find(c => c.id === id);
      if (request.method() === "GET") return chat ? json(route, { ...chat, messageCount: chat.messages?.length ?? 0 }) : route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
      if (request.method() === "DELETE") { db.chats = db.chats.filter(c => c.id !== id); return route.fulfill({ status: 204 }); }
      if (request.method() === "PUT") {
        const next = { id, title: body.title, projectId: body.projectId === GENERAL ? null : body.projectId ?? chat?.projectId ?? null, pinned: chat?.pinned ?? false, mode: body.mode, messages: body.messages ?? chat?.messages ?? [] };
        db.chats = [next, ...db.chats.filter(c => c.id !== id)];
        return json(route, next);
      }
      Object.assign(chat!, body.title !== undefined ? { title: body.title } : {}, body.pinned !== undefined ? { pinned: body.pinned } : {},
        body.projectId !== undefined ? { projectId: body.projectId === GENERAL ? null : body.projectId } : {});
      return json(route, chat);
    }
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  }).then(() => db);
}

test("server sidebar: project folders, chats saved with messages and opened from the account, menus, pin, rename, delete, new tab", async ({ page, context, browser }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const local = { project: { id: "11111111-1111-4111-8111-111111111111", name: "Thesis" }, chat: "22222222-2222-4222-8222-222222222222" };
  await page.addInitScript(l => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("az-projects", JSON.stringify([l.project]));
    localStorage.setItem("az-user-conversations", JSON.stringify([
      { id: l.chat, title: "Literature review", mode: "research", projectId: l.project.id, messages: [{ role: "user", content: "SECRET-MESSAGE-TEXT" }, { role: "assistant", content: "Outline..." }] },
    ]));
  }, local);
  const db = await mockApi(page);
  const chatRequests: Record<string, unknown>[] = [];
  await page.route("**/api/chat/stream", route => {
    chatRequests.push(JSON.parse(route.request().postData() || "{}"));
    return route.fulfill({ json: { data: { answer: "Here's a launch plan.", pipeline: { redacted: {} } } } });
  });
  await page.goto("/");
  const sidebar = page.locator("aside");

  // While loading, the browser's own list shows; then a one-time import of its projects and chat
  // titles, and the server groups (with their actions) render.
  await expect.poll(() => db.calls.filter(c => c.url === "/api/sidebar/import").length).toBe(1);
  await expect(sidebar.getByRole("button", { name: "Add project" })).toBeVisible();
  const imports = db.calls.filter(c => c.url === "/api/sidebar/import");
  // The import uploads this browser's chats with their messages (backfill).
  expect(imports[0].body).toEqual({ projects: [local.project], chats: [{ id: local.chat, title: "Literature review", mode: "research", projectId: local.project.id,
    messages: [{ role: "user", content: "SECRET-MESSAGE-TEXT" }, { role: "assistant", content: "Outline..." }] }] });
  await expect(page.getByText("Chats, their messages and projects are saved to your account")).toBeVisible();

  // Projects are folders: expanding Thesis (open folder) shows its chat underneath.
  const projects = sidebar.getByRole("group", { name: "Projects" });
  const thesis = projects.getByRole("button", { name: "Thesis", exact: true });
  await expect(thesis).toHaveAttribute("aria-expanded", "false");
  await thesis.click();
  await expect(thesis).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByRole("group", { name: "Thesis chats" }).getByRole("button", { name: "Literature review", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("group", { name: "Chats" }).getByText("Your conversations appear here.")).toBeVisible();

  // Add a project through the dialog (folder-plus in the Projects header).
  await sidebar.getByRole("button", { name: "Add project" }).click();
  await page.getByLabel("Project name").fill("Client site");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(projects.getByRole("button", { name: "Client site", exact: true })).toBeVisible();

  // Rename it; a duplicate name is refused with a clear message.
  await sidebar.getByRole("button", { name: "Client site options" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Rename", "Share", "Edit", "Settings", "Delete"]);
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Project name").fill("Thesis");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already exists" })).toBeVisible();
  await page.getByLabel("Project name").fill("Launch");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(projects.getByRole("button", { name: "Launch", exact: true })).toBeVisible();

  // Edit: name and description (shown as the row's tooltip).
  await sidebar.getByRole("button", { name: "Launch options" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Launch");
  await page.getByLabel("Description").fill("Product launch planning");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(projects.getByRole("button", { name: "Launch", exact: true })).toHaveAttribute("title", "Launch — Product launch planning");

  // Settings: instructions for every chat in the project, and the default mode for "+".
  await sidebar.getByRole("button", { name: "Launch options" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByLabel("Instructions").fill("Keep plans to five steps.");
  await page.getByLabel("New chats start in").selectOption("research");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect.poll(() => db.projects.find(p => p.name === "Launch")?.instructions).toBe("Keep plans to five steps.");

  // "+" on a project starts a chat in it (in its default mode), saved into that project — title and
  // mode only, never messages — and the chat request names the project so its instructions apply.
  await sidebar.getByRole("button", { name: "New chat in Launch" }).click();
  await expect(page.getByRole("button", { name: "Explore deeply" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("header")).toContainText("Launch");
  await page.getByRole("textbox").first().fill("Plan the launch");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(2);
  const launchId = db.projects.find(p => p.name === "Launch")!.id;
  const put = db.calls.find(c => c.method === "PUT" && c.url.startsWith("/api/chats/"));
  expect(put?.body).toMatchObject({ title: "Plan the launch", projectId: launchId, mode: "research" });
  expect(chatRequests.at(-1)?.projectId).toBe(launchId);
  // Saved to the account with its messages (question and answer).
  await expect.poll(() => JSON.stringify(db.chats.find(c => c.title === "Plan the launch")?.messages ?? [])).toContain("Here's a launch plan.");
  await expect(sidebar.getByRole("group", { name: "Launch chats" }).getByRole("button", { name: "Plan the launch", exact: true })).toBeVisible();

  // Chat menu: Open new tab, Rename, Pin — divider — Delete.
  await sidebar.getByRole("button", { name: "Literature review options" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Open new tab", "Rename", "Pin", "Delete"]);
  await expect(page.getByRole("menu").getByRole("separator")).toHaveCount(1);
  await page.keyboard.press("Escape");
  // Quick pin on the row (hover); a pinned chat keeps showing it, as "Unpin".
  await sidebar.getByRole("button", { name: "Literature review", exact: true }).hover();
  await sidebar.getByRole("button", { name: "Pin Literature review" }).click();
  await expect.poll(() => db.chats.find(c => c.id === local.chat)?.pinned).toBe(true);
  await page.mouse.move(900, 700);
  await expect(sidebar.getByRole("button", { name: "Unpin Literature review" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Unpin Literature review" })).toHaveCSS("opacity", "1");

  // Drag and drop: a chat moves out of its project to Chats, into another project, and back.
  const chatsGroup = sidebar.getByRole("group", { name: "Chats", exact: true });
  await sidebar.getByRole("group", { name: "Thesis chats" }).getByRole("button", { name: "Literature review", exact: true }).dragTo(chatsGroup);
  await expect.poll(() => db.chats.find(c => c.id === local.chat)?.projectId).toBeNull();
  await expect(chatsGroup.getByRole("button", { name: "Literature review", exact: true })).toBeVisible();
  await chatsGroup.getByRole("button", { name: "Literature review", exact: true }).dragTo(projects.getByRole("button", { name: "Launch", exact: true }));
  await expect.poll(() => db.chats.find(c => c.id === local.chat)?.projectId).toBe(launchId);
  await expect(sidebar.getByRole("group", { name: "Launch chats" }).getByRole("button", { name: "Literature review", exact: true })).toBeVisible();
  await sidebar.getByRole("group", { name: "Launch chats" }).getByRole("button", { name: "Literature review", exact: true }).dragTo(thesis);
  await expect.poll(() => db.chats.find(c => c.id === local.chat)?.projectId).toBe(local.project.id);
  // The browser's copy moved too (the chat's project travels with it).
  expect(await page.evaluate(id => JSON.parse(localStorage.getItem("az-user-conversations") || "[]").find((h: { id: string }) => h.id === id)?.projectId, local.chat)).toBe(local.project.id);

  // Layout: main items at the top, Plugins fixed at the bottom, projects and chats scroll between.
  const plugins = (await sidebar.getByRole("link", { name: "Plugins" }).boundingBox())!;
  const lastChat = (await chatsGroup.boundingBox())!;
  expect(plugins.y).toBeGreaterThanOrEqual(lastChat.y + lastChat.height - 1);

  // Rename a chat (server and this browser).
  await sidebar.getByRole("button", { name: "Plan the launch options" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Title").fill("Launch plan v1");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(sidebar.getByRole("button", { name: "Launch plan v1", exact: true })).toBeVisible();

  // Chats that exist only in the account open in the main view (GET /api/chats/:id), and a project
  // with more chats than listed offers "Show all" (GET /api/chats?projectId=).
  for (let i = 1; i <= 3; i++) db.chats.push({ id: `00000000-0000-4000-8000-00000000000${i}`, title: `Old chat ${i}`, projectId: local.project.id, pinned: false, mode: "chat",
    messages: [{ role: "user", content: `Old question ${i}` }, { role: "assistant", content: `Old answer ${i}` }] });
  await sidebar.getByRole("button", { name: "See all" }).click();
  await expect(sidebar.getByRole("button", { name: "Show all 4 chats" })).toBeVisible();
  await sidebar.getByRole("button", { name: "Show all 4 chats" }).click();
  await expect.poll(() => db.calls.some(c => c.url === `/api/chats?projectId=${local.project.id}`)).toBe(true);
  await expect(sidebar.getByRole("group", { name: "Thesis chats" }).getByRole("button", { name: /^(Literature review|Old chat \d)$/ })).toHaveCount(4);
  await sidebar.getByRole("group", { name: "Thesis chats" }).getByRole("button", { name: "Old chat 3", exact: true }).click();
  await expect(page.locator("article").first()).toContainText("Old question 3");
  await expect(page.locator("article").last()).toContainText("Old answer 3");
  await expect(page.getByRole("status").filter({ hasText: "Loaded from your account." })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Old chat 3", exact: true })).toHaveAttribute("aria-current", "page");
  // A chat the account has no messages for explains where they are.
  db.chats.push({ id: "00000000-0000-4000-8000-000000000009", title: "Untouched", projectId: null, pinned: false, mode: "chat", messages: [] });
  await sidebar.getByRole("button", { name: "See all" }).click();
  await sidebar.getByRole("button", { name: "See all" }).click();
  await sidebar.getByRole("group", { name: "Chats", exact: true }).getByRole("button", { name: "Untouched", exact: true }).click();
  await expect(page.getByText("haven't reached your account yet")).toBeVisible();
  db.chats = db.chats.filter(c => !c.id.startsWith("00000000-0000-4000-8000-"));
  await sidebar.getByRole("button", { name: "See all" }).click();

  // Share: a link holding the project, its settings and chats. Opened by someone else, it offers to add a copy.
  await sidebar.getByRole("button", { name: "Thesis options" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  const shareDialog = page.getByRole("dialog", { name: "Share “Thesis”" });
  // Literature review, plus "Old chat 3" (opened from the account above, so this browser now has its messages).
  await expect(shareDialog).toContainText("2 chats with their messages");
  const link = await shareDialog.getByLabel("Share link").inputValue();
  expect(link).toMatch(/^http:\/\/localhost:3000\/#share-project=/);
  await shareDialog.getByRole("button", { name: "Done" }).click();

  const other = await browser.newContext();
  const recipient = await other.newPage();
  const otherDb = await mockApi(recipient);
  await recipient.goto(link);
  const offer = recipient.getByRole("dialog", { name: "Add “Thesis” to your workspace?" });
  await expect(offer).toContainText("2 chats");
  await offer.getByRole("button", { name: "Add project" }).click();
  await expect(recipient.locator("aside").getByRole("group", { name: "Thesis chats" }).getByRole("button", { name: "Literature review", exact: true })).toBeVisible();
  expect(otherDb.projects.map(p => p.name)).toEqual(["Thesis"]);
  expect(otherDb.chats.map(c => [c.title, c.projectId]).sort()).toEqual([["Literature review", otherDb.projects[0].id], ["Old chat 3", otherDb.projects[0].id]]);
  expect(JSON.stringify(otherDb.chats.find(c => c.title === "Old chat 3")?.messages)).toContain("Old answer 3");
  expect(recipient.url()).not.toContain("#share-project=");
  await other.close();

  // Delete a project: its chat moves to General (listed under Chats).
  await sidebar.getByRole("button", { name: "Thesis options" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText("Its chats move to General.")).toBeVisible();
  await page.getByRole("button", { name: "Delete project" }).click();
  await expect(projects.getByRole("button", { name: "Thesis", exact: true })).toHaveCount(0);
  expect(db.chats.find(c => c.id === local.chat)?.projectId).toBeNull();
  await expect(sidebar.getByRole("group", { name: "Chats" }).getByRole("button", { name: "Literature review", exact: true })).toBeVisible();

  // See all asks the API for every chat.
  await sidebar.getByRole("button", { name: "See all" }).click();
  await expect.poll(() => db.calls.some(c => c.url.includes("chats=all"))).toBe(true);

  // Open new tab (from the menu) loads that chat from this browser.
  await sidebar.getByRole("button", { name: "Literature review options" }).click();
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("menuitem", { name: "Open new tab" }).click(),
  ]);
  await tab.waitForLoadState();
  await expect(tab.locator("article").first()).toContainText("SECRET-MESSAGE-TEXT");
  expect(new URL(tab.url()).search).toBe("");

  // Delete the open chat: the main view empties.
  await sidebar.getByRole("button", { name: "Launch plan v1", exact: true }).click();
  await expect(page.locator("article").first()).toContainText("Plan the launch");
  await sidebar.getByRole("button", { name: "Launch plan v1 options" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete chat" }).click();
  await expect(sidebar.getByRole("button", { name: "Launch plan v1", exact: true })).toHaveCount(0);
  await expect(page.locator("article")).toHaveCount(0);
});
