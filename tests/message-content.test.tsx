import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageContent } from "@/components/message-content";

describe("message rendering", () => {
  it("renders Markdown headings, lists and code without executing HTML", () => {
    const html = renderToStaticMarkup(<MessageContent role="assistant" content={'## Answer\n\n- One\n- Two\n\n```html\n<img src=x onerror=alert(1)>\n```\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))'} />);
    expect(html).toContain('<h2>Answer</h2>');
    expect(html).toContain('<li>One</li>');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('href="javascript:');
  });
  it("treats user HTML as text", () => {
    const html = renderToStaticMarkup(<MessageContent role="user" content={'<img src=x onerror=alert(1)>'} />);
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });
});
