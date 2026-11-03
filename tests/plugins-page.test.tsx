import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PluginsPage } from "@/components/plugins-page";
import type { Plugin } from "@/lib/plugins/service";

const base = { fields: [], settings: {}, managedBy: "user" as const, canManage: true, installed: true, enabled: false };
const plugins: Plugin[] = [
  { ...base, id: "search-index", name: "Search Index", description: "Full-text search.", kind: "feature", category: "search", status: "ready", enabled: true },
  { ...base, id: "vector-search", name: "Vector Search", description: "Semantic search.", kind: "feature", category: "search", status: "blocked", canManage: false, blockedBy: "pgvector missing" },
  { ...base, id: "output-stats", name: "Output Stats", description: "Counts words.", kind: "skill", category: "tool", status: "ready", managedBy: "staff", canManage: false },
];
const render = (query = "") => renderToStaticMarkup(<PluginsPage plugins={plugins} loaded query={query} busy={null} onToggle={() => {}} />);

describe("plugins cards", () => {
  it("shows each plugin with a switch reflecting its state and a Settings button", () => {
    const html = render();
    expect(html).toContain("Search Index");
    expect(html).toMatch(/aria-label="Disable Search Index"[^>]*aria-checked="true"|aria-checked="true"[^>]*aria-label="Disable Search Index"/);
    expect((html.match(/role="switch"/g) ?? []).length).toBe(3);
    expect((html.match(/Settings<\/button>/g) ?? []).length).toBe(3);
  });

  it("blocked plugins say so and cannot be switched on; staff-managed skills explain who manages them", () => {
    const html = render();
    expect(html).toContain("Infrastructure Blocked");
    expect(html).toMatch(/<button[^>]*aria-label="Enable Vector Search"[^>]*disabled|<button[^>]*disabled[^>]*aria-label="Enable Vector Search"/);
    expect(html).toContain("managed by staff administrators");
  });

  it("filters by the search text", () => {
    const html = render("vector");
    expect(html).toContain("Vector Search");
    expect(html).not.toContain("Search Index");
    expect(render("zzz")).toContain("No plugins match.");
  });
});
