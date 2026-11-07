import "server-only";
import { UserError } from "./types";

// Transactional email. Production sends through the Resend HTTP API (RESEND_API_KEY + MAIL_FROM).
// In development, with no key, the message is printed to the server console so flows can be tried
// without a mail account. Links always use APP_ORIGIN, never the request's Host header.

const configured = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
const origin = () => (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");

/** Production needs a real mail provider; development may fall back to the console. */
export function assertMailReady() {
  if (!configured() && process.env.NODE_ENV === "production") throw new UserError(503, "EMAIL_NOT_CONFIGURED");
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!configured()) {
    assertMailReady();
    console.info(`\n[dev mail] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`mail provider answered ${response.status}`);
}

const safeName = (name: string) => name.replace(/[\r\n]/g, " ").slice(0, 100);

export const sendVerificationEmail = (to: string, name: string, token: string) =>
  sendMail(to, "Verify your AZ_AI email",
    `Hi ${safeName(name)},\n\nConfirm your email to finish setting up your AZ_AI account:\n\n${origin()}/verify-email?token=${token}\n\nThis link works once and expires in 24 hours. If you didn't create an account, ignore this email.`);

export const sendResetEmail = (to: string, token: string) =>
  sendMail(to, "Reset your AZ_AI password",
    `Someone asked to reset the password for this AZ_AI account.\n\nChoose a new password:\n\n${origin()}/reset-password?token=${token}\n\nThis link works once and expires in 1 hour. If it wasn't you, ignore this email: your password hasn't changed.`);
