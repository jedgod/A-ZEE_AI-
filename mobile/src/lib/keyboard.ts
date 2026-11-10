import { api } from "./api";
import { API_URL } from "./config";
import { getInstallId } from "./storage";
import { linkKeyboard, linkedUserId, unlinkKeyboard } from "../../modules/azlinqext";

// Everything the app does for the AZLinqext keyboard. The keyboard never receives the app's own
// session: the server mints it a separate, scoped credential (15-minute access token plus a rotating
// refresh token) that is tied to this app session, so signing out here ends it.

export const CONSENT_VERSION = 2; // must match the server: 2 added the modes and the explicit third-party AI provider disclosure

export type Consent = { version: number; replyAssist: boolean; context: boolean; typing: boolean; current: boolean };
export type Plan = {
  tier: "free" | "plus" | "premium"; plan: string;
  features: { context: number; variants: number; maxWords: number; maxInputChars: number; tones: string[]; modes: string[]; personalized: boolean };
  languages: string[];
  disclosure: string;
  typing: { minIntervalSeconds: number; dailyCap: number };
  usage: { used: number; limit: number | null; remaining: number | null; resetsAt: string; separateFromChat: boolean };
  consent: Consent;
};
type Link = { userId: string; accessToken: string; accessExpiresInSeconds: number; refreshToken: string; refreshExpiresAt: string };

export const getPlan = () => api<Plan>("/api/linqext/entitlements");

/**
 * Records what the user agreed to. Agreeing also connects the keyboard; withdrawing disconnects it at once.
 * Only the message the user chooses is ever sent, so "context" (earlier messages) stays off.
 */
export async function setReplyConsent(replyAssist: boolean, userId: string): Promise<Consent> {
  // Turning replies off also turns off "suggest as I type", which depends on it.
  const consent = await api<Consent>("/api/linqext/consent", { method: "PUT", body: { version: CONSENT_VERSION, replyAssist, context: false, typing: false } });
  if (replyAssist) await connectKeyboard(userId);
  else await disconnectKeyboard();
  return consent;
}

/** Asks the server for this device's keyboard credential and hands it to the keyboard's encrypted store. */
export async function connectKeyboard(userId: string, displayName = ""): Promise<void> {
  const link = await api<Link>("/api/linqext/keyboard/link", { method: "POST" });
  await linkKeyboard({
    apiUrl: API_URL, allowHttp: __DEV__ && API_URL.startsWith("http://"), installId: await getInstallId(),
    userId: link.userId || userId, displayName,
    accessToken: link.accessToken, accessExpiresInSeconds: link.accessExpiresInSeconds,
    refreshToken: link.refreshToken, refreshExpiresAt: link.refreshExpiresAt,
  });
}

/** "Suggest as I type": a separate opt-in. Needs replies to be on. */
export const setTypingConsent = (typing: boolean) =>
  api<Consent>("/api/linqext/consent", { method: "PUT", body: { version: CONSENT_VERSION, replyAssist: true, context: false, typing } });

/** Revokes the keyboard's credential on the server (best effort) and erases it from this device. */
export async function disconnectKeyboard(): Promise<void> {
  try { await api("/api/linqext/keyboard/unlink", { method: "POST", skipUnauthorized: true }); } catch { /* the device copy is erased regardless */ }
  await unlinkKeyboard();
}

/** The keyboard on this device belongs to someone else (the account changed): remove it. */
export async function clearIfDifferentAccount(userId: string): Promise<void> {
  const owner = linkedUserId();
  if (owner && owner !== userId) await unlinkKeyboard();
}
