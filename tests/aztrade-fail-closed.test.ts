import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { paperExecutionEnabled } from "@/lib/aztrade/entitlements";

// Release status is NO-GO (AZTrade-Unified/docs/RELEASE_EVIDENCE_MATRIX.md): paper execution and live trading stay off until a certified
// process turns them on. These checks keep it that way by accident-proofing the defaults.
const root = path.resolve(__dirname, "..");

describe("trading stays fail-closed", () => {
  it("paper execution is off unless the flag is exactly the string true", () => {
    expect(paperExecutionEnabled({})).toBe(false);
    expect(paperExecutionEnabled({ AZTRADE_PAPER_EXECUTION_CERTIFIED: "" })).toBe(false);
    expect(paperExecutionEnabled({ AZTRADE_PAPER_EXECUTION_CERTIFIED: "false" })).toBe(false);
    expect(paperExecutionEnabled({ AZTRADE_PAPER_EXECUTION_CERTIFIED: "TRUE" })).toBe(false);
    expect(paperExecutionEnabled({ AZTRADE_PAPER_EXECUTION_CERTIFIED: "1" })).toBe(false);
    expect(paperExecutionEnabled({ AZTRADE_PAPER_EXECUTION_CERTIFIED: "true" })).toBe(true);   // only a certified deployment sets this
  });

  it("no committed configuration or script turns the flag on", () => {
    let files: string[];
    try { files = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean); }
    catch { return; }
    const config = files.filter(f => /(\.env[^/]*|docker-compose[^/]*\.ya?ml|\.ps1|\.sh|\.cjs|\.mjs|\.json)$/i.test(f) && !/(^|\/)(tests?|node_modules|package-lock\.json)/.test(f));
    const bad = config.filter(f => {
      try { return /AZTRADE_PAPER_EXECUTION_CERTIFIED["']?\s*[:=]\s*["']?true\b/i.test(readFileSync(path.join(root, f), "utf8")); } catch { return false; }
    });
    expect(bad, `These files enable paper execution: ${bad.join(", ")}`).toEqual([]);
  });

  it("the release matrix still says NO-GO with live trading off", () => {
    const matrix = readFileSync(path.join(root, "AZTrade-Unified/docs/RELEASE_EVIDENCE_MATRIX.md"), "utf8");
    expect(matrix).toMatch(/Current decision: NO-GO/);
    expect(matrix).toMatch(/Live trading: OFF/);
  });
});
