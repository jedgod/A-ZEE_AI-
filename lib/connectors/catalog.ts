// The Plugins catalog (client-safe; no secrets). Entries with a `provider` connect through the real
// OAuth flow in lib/connectors/service; the rest are listed as coming soon and have no Connect button.

import type { ProviderId } from "./types";

export type CatalogDetail = { icon: "search" | "lock" | "shield"; title: string; body: string };
export type CatalogEntry = {
  id: string;
  name: string;
  category: string;
  /** One line shown in the list. */
  summary: string;
  /** Sentence under the modal title. */
  intro: string;
  section: "Featured" | "Advertising";
  provider?: ProviderId;
  details?: CatalogDetail[];
};

const readOnlyDetails = (service: string, what: CatalogDetail): CatalogDetail[] => [
  what,
  { icon: "lock", title: "We never train on your data", body: `AZ_AI does not train on your ${service} data.` },
  { icon: "shield", title: `Your data stays in ${service}`, body: "Access is read-only. Tokens are encrypted on this server and never sent to the browser; every access is logged." },
];

export const CATALOG: CatalogEntry[] = [
  {
    id: "gmail", name: "Gmail", category: "Productivity", section: "Featured", provider: "gmail",
    summary: "Search your emails", intro: "Give AZ_AI access to search your emails.",
    details: readOnlyDetails("Gmail", { icon: "search", title: "Search your emails", body: "Search your inbox, summarize unread emails, and find messages from specific people." }),
  },
  {
    id: "google_drive", name: "Google Drive", category: "Productivity", section: "Featured", provider: "google_drive",
    summary: "Read your documents", intro: "Give AZ_AI access to read your Drive documents.",
    details: readOnlyDetails("Google Drive", { icon: "search", title: "Read your documents", body: "Search file names and read Docs, Sheets, Slides and text files." }),
  },
  {
    id: "github", name: "GitHub", category: "Developer", section: "Featured", provider: "github",
    summary: "Search repos and PRs", intro: "Give AZ_AI read-only access to your GitHub repositories.",
    details: readOnlyDetails("GitHub", { icon: "search", title: "Browse your repositories", body: "List repositories, browse files and read their contents." }),
  },
  { id: "finance", name: "Finance", category: "Finance", section: "Featured", summary: "Securely connect financial accounts", intro: "Securely connect your financial accounts." },
  { id: "google_calendar", name: "Google Calendar", category: "Productivity", section: "Featured", summary: "Check your schedule", intro: "Let AZ_AI check your schedule." },
  { id: "canva", name: "Canva", category: "Design", section: "Featured", summary: "Create and edit designs", intro: "Create and edit designs with AZ_AI." },
  { id: "shopify", name: "Shopify", category: "Commerce", section: "Featured", summary: "Manage your store", intro: "Manage your store with AZ_AI." },
  { id: "vercel", name: "Vercel", category: "Developer", section: "Featured", summary: "Manage your deploys", intro: "Manage your deploys with AZ_AI." },
  { id: "x_ads", name: "X Ads", category: "Advertising", section: "Advertising", summary: "Manage your ad campaigns", intro: "Manage your X ad campaigns with AZ_AI." },
];

export const providerName = (id: string) => CATALOG.find(c => c.provider === id)?.name ?? id;
