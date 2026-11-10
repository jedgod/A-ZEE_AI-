import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Static safety tests for the A1 bootstrap script. It is not executed here; these lock in its security properties.
const file = path.join(__dirname, "../deploy/oracle/a1/bootstrap-a1.sh");
const sh = readFileSync(file, "utf8");
const code = sh.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

describe("bootstrap-a1.sh", () => {
  // `bash` on a Windows PATH may be WSL (cannot read Windows paths); prefer Git for Windows' bash, else whatever works.
  const bashes = [process.env.BASH, "C:/Program Files/Git/bin/bash.exe", "bash"].filter(Boolean) as string[];
  const usable = bashes.find((b) => { try { return execFileSync(b, ["-c", "echo ok"], { stdio: "pipe", timeout: 8000 }).toString().trim() === "ok"; } catch { return false; } });
  it.skipIf(!usable)("is valid bash", () => {
    const posix = file.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d) => `/${d.toLowerCase()}`);
    let ok = true; try { execFileSync(usable!, ["-n", /^[A-Za-z]:/.test(file) && /Git/i.test(usable!) ? posix : file], { stdio: "pipe", timeout: 15000 }); } catch { ok = false; }
    expect(ok).toBe(true);
  });
  it("is strict and idempotent-by-construction", () => { expect(code).toMatch(/set -euo pipefail/); });
  it("refuses the wrong CPU architecture, root, a missing or wide-open SSH range, and a too-small host", () => {
    expect(code).toMatch(/uname -m.*aarch64[\s\S]*REFUSING/); expect(code).toMatch(/id -u.*-ne 0[\s\S]*REFUSING/); expect(code).toMatch(/ALLOW_SSH_CIDR:-/);
    expect(code).toMatch(/0\.0\.0\.0\/0[\s\S]*REFUSING/); expect(code).toMatch(/-ge 8000/);
  });
  it("never pipes a download into a shell and deletes nothing", () => {
    expect(code).not.toMatch(/(curl|wget)[^\n|]*\|\s*(sudo\s+)?(ba)?sh/); expect(code).not.toMatch(/\brm\s+-|\brm\s+\/|\bshred\b|\bmkfs\b|\bdd\s+if=/);
  });
  it("opens only SSH, only from the allowed range, and removes the open SSH service", () => {
    const rules = [...code.matchAll(/firewall-cmd[^\n]*--add-[a-z-]+=?[^\n]*/g)].map((m) => m[0]);
    expect(rules.length).toBe(1); expect(rules[0]).toMatch(/source address=\$\{ALLOW_SSH_CIDR\} service name=ssh accept/);
    expect(code).toMatch(/--remove-service=ssh/); expect(code).not.toMatch(/--add-port|--add-service|trusted|--set-default-zone=trusted/);
  });
  it("keeps PostgreSQL private: loopback listener, SCRAM only, no trust, no remote hba entries", () => {
    expect(code).toMatch(/listen_addresses = '127\.0\.0\.1'/); expect(code).toMatch(/password_encryption = scram-sha-256/);
    // only the PostgreSQL parts: the script's own "refuse 0.0.0.0/0 for SSH" guard legitimately contains that text
    const pg = code.split("\n").filter((x) => /listen_addresses|pg_hba|^\s*(local|host)\s|PGCONF|HBA/.test(x)).join("\n");
    expect(pg).not.toMatch(/0\.0\.0\.0|\btrust\b|\*/);
    for (const l of code.split("\n").filter((x) => /^\s*host\s+/.test(x))) expect(l).toMatch(/127\.0\.0\.1\/32|::1\/128/);
  });
  it("validates sshd before reloading it and disables passwords and root login", () => {
    expect(code).toMatch(/sshd -t && sudo systemctl reload sshd/); expect(code).toMatch(/PasswordAuthentication no/); expect(code).toMatch(/PermitRootLogin no/);
  });
  it("writes no secrets and keeps the secrets directory private", () => { expect(code).toMatch(/install -d -o azee -g azee -m 0700 \/etc\/azee\/secrets/); expect(code).not.toMatch(/PASSWORD\s*=\s*['"]?[A-Za-z0-9]{8,}|BEGIN [A-Z ]*PRIVATE KEY/); });
  it("supports a dry run", () => { expect(code).toMatch(/DRY_RUN/); expect(code).toMatch(/DRY-RUN:/); });
});
