import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

// The session token and the install id live in the device's secure storage (Keychain on iOS,
// Keystore-encrypted storage on Android), never in plain files or logs.

const TOKEN_KEY = "azee.session";
const INSTALL_KEY = "azee.install";
const ACCESSIBLE = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } as const;

export async function loadToken(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(TOKEN_KEY); } catch { return null; }
}
export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token, ACCESSIBLE);
}
export async function clearToken(): Promise<void> {
  try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch { /* nothing stored */ }
}

let installId: string | null = null;
/** A random id for this install (32 hex characters). The server uses it, with other signals, to spot many free accounts on one device. */
export async function getInstallId(): Promise<string> {
  if (installId) return installId;
  try {
    const existing = await SecureStore.getItemAsync(INSTALL_KEY);
    if (existing && /^[a-f0-9]{32}$/.test(existing)) return (installId = existing);
  } catch { /* fall through and make a new one */ }
  const bytes = Crypto.getRandomBytes(16);
  installId = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  try { await SecureStore.setItemAsync(INSTALL_KEY, installId, ACCESSIBLE); } catch { /* still works for this run */ }
  return installId;
}

/** A random RFC 4122 v4 UUID for new chats (the server requires UUIDs). */
export function newId(): string {
  return Crypto.randomUUID();
}
