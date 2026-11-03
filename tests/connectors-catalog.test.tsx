import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectorsApp } from "@/components/connectors/connectors-app";

describe("plugins catalog page", () => {
  const html = renderToStaticMarkup(<ConnectorsApp />);

  it("shows the Connectors and Skills tabs, a search box and the Featured and Advertising sections", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>connectors</);
    expect(html).toContain('aria-label="Search connectors"');
    expect(html).toContain("<h2");
    expect(html).toContain(">Featured<");
    expect(html).toContain(">Advertising<");
  });

  it("lists each connector with its summary and an Add button", () => {
    for (const [name, summary] of [["Gmail", "Search your emails"], ["Google Calendar", "Check your schedule"], ["GitHub", "Search repos and PRs"], ["X Ads", "Manage your ad campaigns"]]) {
      expect(html).toContain(`aria-label="${name}: ${summary}"`);
      expect(html).toContain(`aria-label="Add ${name}"`);
    }
  });

  it("opens no dialog until a connector is chosen", () => {
    expect(html).not.toContain('role="dialog"');
  });
});
