import "server-only";
import { z } from "zod";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { pool } from "@/lib/admin/db";
import { ollamaOnly } from "@/lib/pipeline/privacy";
import { decrypt, encrypt } from "./crypto";
import { audit } from "./service";
import { ConnectorError } from "./types";

// Yahoo Mail and iCloud Mail, read-only, over IMAP/TLS (port 993) with an app-specific password. The hosts
// are fixed here, so a request can never point the server at another machine. Credentials are sealed with
// the connector key before they are stored, never returned to the app, and deleted on disconnect.

export type ImapProvider = "yahoo" | "icloud";
export const IMAP_HOSTS: Record<ImapProvider, string> = { yahoo: "imap.mail.yahoo.com", icloud: "imap.mail.me.com" };
export const isImapProvider = (v: unknown): v is ImapProvider => v === "yahoo" || v === "icloud";

export const connectInput = z.object({
  provider: z.enum(["yahoo", "icloud"]),
  email: z.string().trim().toLowerCase().email().max(254),
  // Apple and Yahoo show the code in groups ("abcd-efgh-ijkl-mnop"); spaces are not part of it.
  appPassword: z.string().transform(s => s.replace(/\s+/g, "")).pipe(z.string().min(8).max(100)),
}).strict();

export type UnreadEmail = { provider: ImapProvider; from: string; subject: string; snippet: string; receivedAt: string };

/** The few ImapFlow calls we use, so tests can stand in for a mail server. */
export interface ImapClient {
  connect(): Promise<unknown>;
  logout(): Promise<unknown>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  search(query: { seen: boolean }, options: { uid: boolean }): Promise<number[] | false>;
  fetch(range: number[], query: { uid: boolean; source: { maxLength: number } }, options: { uid: boolean }): AsyncIterable<{ source?: Buffer }>;
}
export type ImapFactory = (host: string, user: string, pass: string) => ImapClient;
const realClient: ImapFactory = (host, user, pass) =>
  new ImapFlow({ host, port: 993, secure: true, auth: { user, pass }, logger: false }) as unknown as ImapClient;

const MAX_EMAILS = 10;
const MAX_SOURCE_BYTES = 40_000; // headers plus the start of the body is all a snippet needs

function guard() {
  if (ollamaOnly()) throw new ConnectorError(403, "EXTERNAL_DATA_DISABLED"); // same privacy gate as the other connectors
}

export async function listAccounts(ownerId: string): Promise<{ provider: ImapProvider; email: string }[]> {
  return (await pool.query(`SELECT provider, email FROM imap_accounts WHERE owner_id = $1 ORDER BY provider`, [ownerId])).rows;
}

/** Checks the login against the provider (TLS, port 993) and, only if it works, stores the sealed credentials. */
export async function connectAccount(ownerId: string, input: z.input<typeof connectInput>, makeClient: ImapFactory = realClient) {
  guard();
  const { provider, email, appPassword } = connectInput.parse(input);
  const client = makeClient(IMAP_HOSTS[provider], email, appPassword);
  try {
    await client.connect();
    await client.logout().catch(() => undefined);
  } catch (error) {
    const e = error as { authenticationFailed?: boolean; responseText?: string; code?: string };
    const rejected = e.authenticationFailed === true || /auth|credential|login|password/i.test(`${e.responseText ?? ""} ${(error as Error).message}`);
    await audit(ownerId, provider, "imap.connect", "failure", email, rejected ? "login rejected" : "unreachable");
    throw new ConnectorError(rejected ? 401 : 502, rejected ? "IMAP_AUTH_FAILED" : "IMAP_UNREACHABLE");
  }
  const sealed = encrypt(JSON.stringify({ email, appPassword })); // throws ConnectorKeyMissingError when no key is set
  await pool.query(
    `INSERT INTO imap_accounts (owner_id, provider, email, credentials_enc) VALUES ($1, $2, $3, $4)
     ON CONFLICT (owner_id, provider) DO UPDATE SET email = EXCLUDED.email, credentials_enc = EXCLUDED.credentials_enc, updated_at = now()`,
    [ownerId, provider, email, sealed],
  );
  await audit(ownerId, provider, "imap.connect", "success", email);
  return { provider, email };
}

/** Deletes the account and its stored credentials. False when it was not connected. */
export async function disconnectAccount(ownerId: string, provider: ImapProvider): Promise<boolean> {
  const r = await pool.query(`DELETE FROM imap_accounts WHERE owner_id = $1 AND provider = $2 RETURNING email`, [ownerId, provider]);
  if (r.rowCount) await audit(ownerId, provider, "disconnect", "success", r.rows[0].email);
  return r.rowCount === 1;
}

async function latestUnread(provider: ImapProvider, email: string, appPassword: string, makeClient: ImapFactory): Promise<UnreadEmail[]> {
  const client = makeClient(IMAP_HOSTS[provider], email, appPassword);
  const out: UnreadEmail[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      const latest = uids.slice(-MAX_EMAILS);
      if (latest.length) {
        for await (const message of client.fetch(latest, { uid: true, source: { maxLength: MAX_SOURCE_BYTES } }, { uid: true })) {
          if (!message.source) continue;
          const parsed = await simpleParser(message.source);
          out.push({
            provider, from: parsed.from?.text || "Unknown sender", subject: parsed.subject || "(no subject)",
            snippet: (parsed.text || "").replace(/\s+/g, " ").trim().slice(0, 200), receivedAt: parsed.date ? parsed.date.toISOString() : "",
          });
        }
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => undefined); }
  return out.reverse(); // newest first
}

/** The latest unread messages (up to 10 per account) from the connected Yahoo/iCloud accounts. One failing account does not hide the others. */
export async function unreadEmails(ownerId: string, only?: ImapProvider, makeClient: ImapFactory = realClient) {
  guard();
  const rows = (await pool.query(
    `SELECT provider, credentials_enc FROM imap_accounts WHERE owner_id = $1 AND ($2::text IS NULL OR provider = $2) ORDER BY provider`, [ownerId, only ?? null],
  )).rows as { provider: ImapProvider; credentials_enc: string }[];
  const emails: UnreadEmail[] = [];
  const errors: { provider: ImapProvider; error: string }[] = [];
  for (const row of rows) {
    try {
      const { email, appPassword } = JSON.parse(decrypt(row.credentials_enc)) as { email: string; appPassword: string };
      emails.push(...await latestUnread(row.provider, email, appPassword, makeClient));
      await audit(ownerId, row.provider, "imap.read", "success", "INBOX");
    } catch (error) {
      errors.push({ provider: row.provider, error: "READ_FAILED" });
      await audit(ownerId, row.provider, "imap.read", "failure", "INBOX", (error as Error).message.slice(0, 200));
    }
  }
  return { emails, errors };
}
