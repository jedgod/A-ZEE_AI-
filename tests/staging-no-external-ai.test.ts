import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Regression guard for a real mistake: "blanking" provider keys with '' does NOT work on Windows (the variable is removed, so Next.js loads the real
// key from .env.local). Staging must disable external AI by MODE.
const up = readFileSync(path.join(__dirname, "../scripts/staging/native-up.ps1"), "utf8");
describe("native staging disables external AI by mode", () => {
  it("the app starts in ollama-only mode by default", () => { expect(up).toMatch(/Start-Svc 'app'[\s\S]*?AZ_PROVIDER_MODE\s*=\s*'ollama-only'/); });
  it("no provider key is 'blanked' with an empty value (ineffective on Windows)", () => { expect(up).not.toMatch(/\$blank\[\$k\]\s*=\s*''/); expect(up).not.toMatch(/_API_KEY\s*=\s*''/); });
  it("the compose files never set a cloud provider key or leave the mode implicit", () => {
    const compose = readFileSync(path.join(__dirname, "../deploy/azee-staging-local/compose.yaml"), "utf8");
    expect(compose).not.toMatch(/(OPENAI|GEMINI|GROQ|MISTRAL|TOGETHER|OPENROUTER|ANTHROPIC|XAI)\w*_API_KEY/);
    expect(compose).toMatch(/app:[\s\S]*?AZ_PROVIDER_MODE:\s*ollama-only/);
  });
});
