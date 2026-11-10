import { describe, it, expect } from "vitest";
import { assertSecureDeployment, deploymentProblems } from "@/lib/aztrade/deploy-config";

const good = {
  NODE_ENV: "production", AZEE_ENV: "azee-staging", AZEE_SECRET_PROVIDER: "file", AZEE_SECRETS_DIR: "/run/secrets",
  AZEE_INTROSPECTION_MTLS_CERT_FILE: "/run/secrets/c", AZEE_INTROSPECTION_MTLS_KEY_FILE: "/run/secrets/k", AZEE_INTROSPECTION_MTLS_CA_FILE: "/run/secrets/ca",
  AZTRADE_MTLS_SERVER_CERT_FILE: "/run/secrets/sc", AZTRADE_MTLS_SERVER_KEY_FILE: "/run/secrets/sk", AZTRADE_MTLS_CLIENT_CA_FILE: "/run/secrets/cca", AZTRADE_MTLS_CRL_FILE: "/run/secrets/crl",
  AZTRADE_MTLS_ALLOWED_CLIENT_CNS: "aztrade-api", AZTRADE_SERVICE_SECRET: "x".repeat(40), AZEE_JWT_ISSUER: "https://issuer.invalid", AZTRADE_JWT_KID: "k1",
  AZTRADE_DATABASE_URL: "postgres://aztrade_app:pw@db.internal:5432/aztrade", AZTRADE_MIGRATION_DATABASE_URL: "postgres://aztrade_owner:pw@db.internal:5432/aztrade", AZTRADE_MTLS_LISTEN_HOST: "10.0.0.5",
};

describe("production/staging configuration is rejected when security settings are missing or unsafe", () => {
  it("accepts a complete configuration and ignores development/test", () => {
    expect(deploymentProblems(good)).toEqual([]);
    expect(deploymentProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(deploymentProblems({ NODE_ENV: "test", AZEE_ENV: "test" })).toEqual([]);
  });
  it("treats a named non-development environment as strict even when NODE_ENV is not production", () => {
    expect(deploymentProblems({ AZEE_ENV: "azee-staging" }).length).toBeGreaterThan(5);
  });
  it.each(Object.keys(good).filter((k) => !["NODE_ENV", "AZEE_ENV", "AZTRADE_MIGRATION_DATABASE_URL", "AZTRADE_MTLS_LISTEN_HOST", "AZEE_SECRETS_DIR"].includes(k)))("a missing %s is refused", (key) => {
    const env: Record<string, string | undefined> = { ...good }; delete env[key];
    // the CN allowlist may be replaced by fingerprints, so removing only the CN list is a different valid shape
    if (key === "AZTRADE_MTLS_ALLOWED_CLIENT_CNS") { expect(deploymentProblems(env).join()).toMatch(/allowlist/); return; }
    expect(deploymentProblems(env).length).toBeGreaterThan(0);
  });
  it("refuses unsafe values", () => {
    expect(deploymentProblems({ ...good, AZEE_SECRET_PROVIDER: "env" }).join()).toMatch(/env provider/);
    expect(deploymentProblems({ ...good, AZTRADE_SERVICE_SECRET: "short" }).join()).toMatch(/32/);
    expect(deploymentProblems({ ...good, AZTRADE_INTROSPECT_ROUTE: "public" }).join()).toMatch(/never be public/);
    expect(deploymentProblems({ ...good, AZTRADE_MTLS_LISTEN_HOST: "0.0.0.0" }).join()).toMatch(/private interface/);
    expect(deploymentProblems({ ...good, AZEE_JWT_ISSUER: "http://issuer.invalid" }).join()).toMatch(/https/);
    expect(deploymentProblems({ ...good, AZTRADE_DATABASE_URL: "postgres://postgres:pw@db.internal/aztrade" }).join()).toMatch(/least-privilege/);
    expect(deploymentProblems({ ...good, AZTRADE_DATABASE_URL: good.AZTRADE_MIGRATION_DATABASE_URL }).join()).toMatch(/least-privilege|differ/);
    expect(deploymentProblems({ ...good, AZTRADE_DATABASE_URL: "postgres://aztrade_app:pw@localhost/aztrade" }).join()).toMatch(/local development/);
  });
  it("is role-aware: a listener does not need client certificates and a client does not need listener material", () => {
    const listener: Record<string, string | undefined> = { ...good }; for (const k of ["AZEE_INTROSPECTION_MTLS_CERT_FILE", "AZEE_INTROSPECTION_MTLS_KEY_FILE", "AZEE_INTROSPECTION_MTLS_CA_FILE"]) delete listener[k];
    expect(deploymentProblems(listener, "listener")).toEqual([]); expect(deploymentProblems(listener, "all").length).toBe(3);
    const client: Record<string, string | undefined> = { ...good }; for (const k of ["AZTRADE_MTLS_SERVER_CERT_FILE", "AZTRADE_MTLS_SERVER_KEY_FILE", "AZTRADE_MTLS_CLIENT_CA_FILE", "AZTRADE_MTLS_CRL_FILE", "AZTRADE_MTLS_ALLOWED_CLIENT_CNS"]) delete client[k];
    expect(deploymentProblems(client, "client")).toEqual([]);
    expect(deploymentProblems({ ...listener, AZTRADE_MTLS_CRL_FILE: "" }, "listener").join()).toMatch(/revocation/);
  });
  it("the error names settings but never echoes secret values", () => {
    const secret = "TOP-SECRET-VALUE-" + "y".repeat(30);
    try { assertSecureDeployment({ ...good, AZTRADE_SERVICE_SECRET: secret, AZEE_SECRET_PROVIDER: "env" }); throw new Error("should refuse"); }
    catch (e) { expect((e as Error).message).toMatch(/Refusing to start/); expect((e as Error).message).not.toContain(secret); }
  });
});
