import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The reverse-tunnel design is NOT activated; these tests lock in its security properties so a later edit cannot quietly weaken them.
const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf8");
describe("PC-side tunnel script", () => {
  // code only: strip the block comment and full-line comments, so the guarantees are checked in what executes, not in the prose describing them
  const ps = read("scripts/staging/ollama-tunnel.ps1").replace(/<#[\s\S]*?#>/, "").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  it("is a dry run unless -Activate is given", () => { expect(ps).toMatch(/if \(-not \$Activate\)[\s\S]*?exit 0/); expect(ps.indexOf("if (-not $Activate)")).toBeLessThan(ps.indexOf("& ssh @sshArgs")); });
  it("verifies the host key strictly against a pinned file and never trusts on first use", () => {
    expect(ps).toContain("StrictHostKeyChecking=yes"); expect(ps).toContain("UserKnownHostsFile=$known"); expect(ps).toContain("GlobalKnownHostsFile=NUL");
    expect(ps).not.toMatch(/accept-new|StrictHostKeyChecking=(no|accept)|UserKnownHostsFile=(NUL|\/dev\/null)/i);
  });
  it("binds the Oracle side to loopback only and fails closed", () => {
    expect(ps).toMatch(/'-R', "127\.0\.0\.1:\$\{RemotePort\}:127\.0\.0\.1:\$\{LocalPort\}"/); expect(ps).not.toMatch(/0\.0\.0\.0|GatewayPorts/);
    for (const o of ["ExitOnForwardFailure=yes", "ServerAliveInterval=15", "ServerAliveCountMax=3", "BatchMode=yes", "IdentitiesOnly=yes", "PasswordAuthentication=no", "ForwardAgent=no"]) expect(ps).toContain(o);
  });
  it("requires a dedicated identity and an unprivileged account", () => { expect(ps).toMatch(/azee-oracle\.key/); expect(ps).toMatch(/DEDICATED key/); expect(ps).toMatch(/'root', 'opc'/); });
});
describe("Oracle-side templates", () => {
  const sshd = read("deploy/oracle/ollama-tunnel/sshd_config.d-ollama-tunnel.conf"), keys = read("deploy/oracle/ollama-tunnel/authorized_keys.example"), unit = read("deploy/oracle/systemd/azee-ollama-health.service");
  it("sshd: one loopback listener, no shell, no tty, no other forwarding, no password login", () => {
    expect(sshd).toMatch(/AllowTcpForwarding remote/); expect(sshd).toMatch(/PermitListen 127\.0\.0\.1:11434/); expect(sshd).toMatch(/GatewayPorts no/); expect(sshd).toMatch(/PermitTTY no/);
    expect(sshd).toMatch(/PasswordAuthentication no/); expect(sshd).toMatch(/ForceCommand \/sbin\/nologin/); expect(sshd).not.toMatch(/GatewayPorts (yes|clientspecified)|AllowTcpForwarding (yes|all)/);
  });
  it("authorized_keys template restricts the key and holds no real key", () => { expect(keys).toMatch(/restrict,port-forwarding,permitlisten="127\.0\.0\.1:11434",command="\/sbin\/nologin"/); expect(keys).toContain("REPLACE_WITH_THE_DEDICATED_PUBLIC_KEY"); });
  it("the health unit is sandboxed and limited to loopback egress", () => { expect(unit).toMatch(/IPAddressDeny=any/); expect(unit).toMatch(/IPAddressAllow=127\.0\.0\.0\/8/); expect(unit).toMatch(/NoNewPrivileges=yes/); });
});
