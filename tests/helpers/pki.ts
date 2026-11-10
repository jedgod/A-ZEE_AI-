import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Disposable test PKI built with the openssl CLI. Everything lives in a temp directory removed after the run.
export function createPki() {
  const dir = mkdtempSync(path.join(tmpdir(), "pki-"));
  const ossl = (...a: string[]) => execFileSync("openssl", a, { cwd: dir, stdio: "pipe" });
  const w = (f: string, t: string) => writeFileSync(path.join(dir, f), t);
  const f = (n: string) => path.join(dir, n);
  const ca = (name: string) => {
    mkdirSync(path.join(dir, name)); w(`${name}/index.txt`, ""); w(`${name}/serial`, "01\n"); w(`${name}/crlnumber`, "01\n");
    w(`${name}.cnf`, `[ca]\ndefault_ca=c\n[c]\ndatabase=${name}/index.txt\nserial=${name}/serial\ncrlnumber=${name}/crlnumber\nnew_certs_dir=${name}\ndefault_md=sha256\ndefault_days=2\ndefault_crl_days=1\npolicy=p\nunique_subject=no\ncopy_extensions=none\n[p]\ncommonName=supplied\n[req]\ndistinguished_name=d\nprompt=no\n[d]\nCN=${name}\n[v3ca]\nbasicConstraints=critical,CA:true\nkeyUsage=keyCertSign,cRLSign\n`);
    ossl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.pem`, "-days", "2", "-config", `${name}.cnf`, "-extensions", "v3ca");
  };
  /** Issues `file`.pem/.key with subject CN=cn. `expired` backdates validity so the certificate is already expired. */
  const leaf = (issuer: string, file: string, cn = file, opts: { server?: boolean; expired?: boolean } = {}) => {
    ossl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", `${file}.key`, "-out", `${file}.csr`, "-subj", `/CN=${cn}`);
    w(`${file}.ext`, opts.server ? "subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\n" : "extendedKeyUsage=clientAuth\n");
    const dates = opts.expired ? ["-startdate", "20200101000000Z", "-enddate", "20200102000000Z"] : [];
    ossl("ca", "-batch", "-config", `${issuer}.cnf`, "-cert", `${issuer}.pem`, "-keyfile", `${issuer}.key`, "-in", `${file}.csr`, "-out", `${file}.pem`, "-extfile", `${file}.ext`, "-notext", ...dates);
  };
  const crl = (issuer: string) => ossl("ca", "-config", `${issuer}.cnf`, "-cert", `${issuer}.pem`, "-keyfile", `${issuer}.key`, "-gencrl", "-out", `${issuer}.crl`);
  const revoke = (issuer: string, file: string) => { ossl("ca", "-config", `${issuer}.cnf`, "-cert", `${issuer}.pem`, "-keyfile", `${issuer}.key`, "-revoke", `${file}.pem`); crl(issuer); };
  const fingerprint = (file: string) => execFileSync("openssl", ["x509", "-in", f(`${file}.pem`), "-noout", "-fingerprint", "-sha256"], { encoding: "utf8" }).split("=")[1].trim();
  const clientEnv = (client: string, trustedServerCa: string) => ({ AZEE_INTROSPECTION_MTLS_CERT_FILE: f(`${client}.pem`), AZEE_INTROSPECTION_MTLS_KEY_FILE: f(`${client}.key`), AZEE_INTROSPECTION_MTLS_CA_FILE: f(`${trustedServerCa}.pem`) });
  return { dir, f, ca, leaf, crl, revoke, fingerprint, clientEnv, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
