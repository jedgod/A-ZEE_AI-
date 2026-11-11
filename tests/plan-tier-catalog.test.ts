import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { tierForPlan } from "@/lib/linqext/policy";

// The effective plan catalog is whatever migrations 008 + 009 leave behind. Every plan id MUST have an explicit expected tier here, so
// adding a plan without deciding its tier fails this test instead of silently falling through to "free" (which is how paid Pro plans
// once lost AZTrade privileges). AZTrade's own mapPlan has the identical matrix in AZTrade/backend/tests/identity.test.js.
const EXPECTED: Record<string, "free" | "plus" | "premium"> = { free: "free", go: "plus", plus: "plus", pro25: "premium", pro60: "premium", pro500: "premium", business: "premium", enterprise: "premium" };
const sql = (f: string) => readFileSync(path.join(__dirname, "../migrations", f), "utf8");

function effectiveCatalog(): string[] {
  const ids = new Set<string>();
  for (const m of sql("008_plans_subscriptions.sql").matchAll(/^\s*\('([a-z0-9_]+)',\s*'[^']+',\s*[\d.]+,\s*'(?:month|user\/month|custom)'/gm)) ids.add(m[1]);
  for (const m of sql("009_rename_pro_plans.sql").matchAll(/SELECT\s+'([a-z0-9_]+)',\s*'[^']+',\s*base_price_usd/g)) ids.add(m[1]);
  const del = sql("009_rename_pro_plans.sql").match(/DELETE FROM plans WHERE id IN \(([^)]*)\)/)?.[1] ?? "";
  for (const m of del.matchAll(/'([a-z0-9_]+)'/g)) ids.delete(m[1]);
  return [...ids].sort();
}

describe("plan -> tier catalog", () => {
  it("the catalog parsed from the migrations is exactly the set this test classifies", () => { expect(effectiveCatalog()).toEqual(Object.keys(EXPECTED).sort()); });
  it("every live plan id maps to its tier", () => { for (const [plan, tier] of Object.entries(EXPECTED)) expect(tierForPlan(plan), plan).toBe(tier); });
  it("legacy ids still work and unknown or look-alike names are never upgraded", () => {
    for (const p of ["pro100", "pro200", "pro"]) expect(tierForPlan(p), p).toBe("premium");
    for (const p of ["", "professional", "business_x", "enterprisey", "Pro25", "constructor", "mystery", "pro12345", "pro9999", "pro0", "pro26"]) expect(tierForPlan(p), p).toBe("free");
  });
});
