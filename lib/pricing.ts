// lib/pricing.ts
// Regional pricing shared by the pricing page (client) and the plans API (server).
export const DEVELOPING_REGIONS = ["NG","KE","ZA","GH","EG","BR","AR","CO","PE","IN","ID","PH","VN","TH","BD","PK"];

export function getRegionalPrice(baseUsd: number, region: string) {
  const discount = DEVELOPING_REGIONS.includes(region) ? 0.9 : 1;
  return Math.round(baseUsd * discount * 100) / 100;
}

export const hasRegionalDiscount = (region: string | null | undefined) => !!region && DEVELOPING_REGIONS.includes(region);

/** "$5", "$4.50", "$13.49": cents only when there are cents. */
export function formatUsd(amount: number) {
  return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

/** ISO 3166-1 alpha-2, uppercase; anything else means "unknown region" (no discount). */
export function normalizeRegion(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : null;
}
