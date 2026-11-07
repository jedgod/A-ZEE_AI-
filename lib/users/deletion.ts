import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "@/lib/admin/db";
import { deleteCustomer, paymentsConfigured, StripeError } from "@/lib/payments/stripe";
import { verifyPassword } from "@/lib/staff/password";
import { allow, sessionUser, strictOrigin } from "./auth";
import { sendMail } from "./mail";
import { UserError } from "./types";

// Account deletion (required by the App Store and Google Play for apps with sign-up). The user
// confirms with their password and the word DELETE; their data is removed, saved payment methods
// are deleted at Stripe first, and every session ends. Kept on purpose, unlinked from them:
// payment records (accounting) and, for up to 90 days, the device signals of an account that had
// used up its free plan (so deleting and re-registering can't reset the free allowance).

export const deleteInput = z.object({ password: z.string().min(1).max(200), confirm: z.literal("DELETE") }).strict();

export async function deleteAccount(request: Request, raw: unknown): Promise<void> {
  strictOrigin(request);
  // An unverified account can delete itself too (it may never have received the email).
  const user = await sessionUser(request, { allowUnverified: true });
  if (!user) throw new UserError(401, "SIGN_IN_REQUIRED");
  if (!await allow("delete-account", user.id, 3)) throw new UserError(429, "RATE_LIMITED");
  const { password } = deleteInput.parse(raw);

  const cred = (await pool.query(`SELECT password_hash FROM user_credentials WHERE user_id = $1`, [user.id])).rows[0];
  if (!cred || !await verifyPassword(password, cred.password_hash)) throw new UserError(403, "WRONG_PASSWORD");

  // Card and bank details live at Stripe: delete them there first, so a failure here can simply be retried.
  const customer = (await pool.query(`SELECT provider_customer_id FROM payment_customers WHERE user_id = $1`, [user.id])).rows[0]?.provider_customer_id;
  if (customer && paymentsConfigured()) {
    try { await deleteCustomer(customer); }
    catch (error) {
      if (!(error instanceof StripeError && (error.status === 404 || error.code === "resource_missing"))) throw new UserError(502, "PAYMENT_PROVIDER_ERROR");
    }
  }

  await transaction(async db => {
    const usedFreeAllowance = (await db.query(`SELECT 1 FROM free_quota_events WHERE user_id = $1 AND exhausted_at > now() - interval '90 days' LIMIT 1`, [user.id])).rowCount;
    if (usedFreeAllowance) {
      // Keep only the device facts, under an id that points at no one.
      const ghost = `deleted:${randomUUID()}`;
      await db.query(`UPDATE device_signals SET user_id = $2, user_agent = NULL WHERE user_id = $1`, [user.id, ghost]);
      await db.query(`UPDATE free_quota_events SET user_id = $2 WHERE user_id = $1`, [user.id, ghost]);
    } else {
      await db.query(`DELETE FROM device_signals WHERE user_id = $1`, [user.id]);
      await db.query(`DELETE FROM free_quota_events WHERE user_id = $1`, [user.id]);
    }
    // Rows that mention the account without a foreign key.
    await db.query(`DELETE FROM operations_records WHERE user_id = $1`, [user.id]);
    await db.query(`DELETE FROM usage_counters WHERE subject = $1`, [`account:${user.id}`]);
    await db.query(`DELETE FROM access_audit WHERE subject = $1`, [`account:${user.id}`]);
    await db.query(`UPDATE complaints SET customer_name = 'Deleted user', customer_contact = NULL WHERE lower(customer_contact) = lower($1)`, [user.email]);
    // Everything else cascades: sessions, credentials, chats, projects, favorites, notifications,
    // prompts, saved payment methods, subscriptions, workspaces, search and connector data.
    await db.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  });

  await sendMail(user.email, "Your AZ_AI account was deleted",
    "Your AZ_AI account and its data have been deleted, and you've been signed out everywhere.\n\nIf you didn't ask for this, contact support right away.").catch(() => undefined);
}
