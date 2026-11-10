import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// These scripts act on the owner's Oracle account (run by the owner in Cloud Shell). Lock in: dry-run by default, explicit confirmation, no credentials,
// no destructive operations, and the narrow scope that was approved.
const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf8");
const strip = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const create = strip(read("deploy/oracle/a1/cloudshell-create-a1.sh")), disable = strip(read("deploy/oracle/cloudshell-disable-run-command.sh"));

describe("cloud shell scripts", () => {
  it("both are dry runs unless CONFIRM=yes", () => {
    for (const s of [create, disable]) { expect(s).toMatch(/CONFIRM:-no/); expect(s).toMatch(/DRY RUN/); }
    expect(create.indexOf('CONFIRM:-no')).toBeLessThan(create.indexOf("for AD in"));
    expect(disable.indexOf('CONFIRM:-no')).toBeLessThan(disable.indexOf("instance update"));
  });
  it("neither deletes, terminates, resizes or stops anything", () => {
    // checked on the oci subcommands and shell commands, not on user-facing messages
    for (const s of [create, disable]) { expect(s).not.toMatch(/\boci\s+\S+\s+\S+\s+(terminate|delete|action|update-shape)\b/); expect(s).not.toMatch(/\brm\s+-|\bshutdown\b|\breboot\b/); }
    expect(disable.match(/\boci\s+compute\s+instance\s+(\w[\w-]*)/g)?.map((x) => x.split(/\s+/).pop())).toEqual(["list", "get", "update"]);
  });
  it("the creator refuses private keys, non-public-key files, oversized A1 requests and a missing image/subnet", () => {
    expect(create).toMatch(/PRIVATE KEY[\s\S]*REFUSING/); expect(create).toMatch(/ssh-ed25519\|ssh-rsa\|ecdsa-sha2-/); expect(create).toMatch(/-le 4[\s\S]*-le 24[\s\S]*REFUSING/);
    expect(create).toMatch(/REFUSING: subnet/); expect(create).toMatch(/REFUSING: no Oracle Linux 9 image/);
  });
  it("the creator opens no ports itself, reuses the existing subnet, and uses the aarch64-compatible image lookup", () => {
    expect(create).not.toMatch(/security-list|ingress|0\.0\.0\.0/); expect(create).toMatch(/--shape "\$SHAPE"/); expect(create).toMatch(/--subnet-id "\$SUBNET"/);
  });
  it("the plugin script touches only the Run Command plugin and keeps monitoring enabled", () => {
    expect(disable).toMatch(/"Compute Instance Run Command","desiredState":"DISABLED"/); expect(disable).toMatch(/"Compute Instance Monitoring","desiredState":"ENABLED"/);
    expect([...disable.matchAll(/"desiredState":"DISABLED"/g)].length).toBe(1);
  });
  it("contain no credentials or key material", () => { for (const s of [create, disable]) { expect(s).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY|ocid1\.[a-z]+\.oc1\.[a-z0-9-]*\.[a-z0-9]{30,}|AKIA|password\s*=/i); } });
});
