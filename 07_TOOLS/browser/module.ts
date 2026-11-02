// ============================================================
// 07_TOOLS / BROWSER
// File: lib/07_tools/browser.ts
// SERVER-ONLY INTEGRATION TEMPLATE
// ============================================================

import "server-only";
import { z } from "zod";
import {
  AuthContext, requirePermission
} from "../../lib/execution/contracts";

const schema = z.object({ url: z.string().url().max(2000) }).strict();

export interface BrowserService {
  read(input: {
    url: string; timeoutMs: number; maxBytes: number;
    allowDownloads: false; allowForms: false;
  }): Promise<{ finalUrl: string; title: string; text: string }>;
}

export async function runBrowser(
  auth: AuthContext, raw: unknown, browser: BrowserService
) {
  requirePermission(auth, "tools:browser");
  const input = schema.parse(raw);
  const url = new URL(input.url);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Only credential-free HTTPS URLs are allowed");
  }

  const page = await browser.read({
    url: url.href, timeoutMs: 10000, maxBytes: 1000000,
    allowDownloads: false, allowForms: false,
  });
  return {
    sourceUrl: page.finalUrl,
    title: page.title.slice(0, 300),
    text: page.text.slice(0, 20000),
    trust: "untrusted" as const,
  };
}

// Service must block private/reserved IPs, cloud metadata,
// DNS rebinding, disallowed ports, and unsafe redirects.
// Check EVERY redirect and subresource through controlled egress.
// Never attach internal cookies, credentials, or session tokens.
