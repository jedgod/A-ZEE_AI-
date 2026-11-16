import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

export type KeyboardStatus = { enabled: boolean; selected: boolean; linked: boolean; linkedUserId: string | null };

type Native = {
  getStatus(): Promise<KeyboardStatus>;
  linkKeyboard(link: KeyboardLink): Promise<boolean>;
  unlinkKeyboard(): Promise<boolean>;
  linkedUserId(): string | null;
  openKeyboardSettings(): Promise<boolean>;
  showKeyboardPicker(): Promise<boolean>;
  getAutopilot(): Promise<Autopilot>;
  setAutopilot(change: Partial<AutopilotChange>): Promise<boolean>;
  getAutopilotLog(): Promise<AutopilotLogEntry[]>;
  clearAutopilotLog(): Promise<boolean>;
  openNotificationAccess(): Promise<boolean>;
  openAppInfo(): Promise<boolean>;
  getDraft(id: number): Promise<AutopilotDraft | null>;
  sendDraft(id: number, text: string): Promise<boolean>;
  dismissDraft(id: number): Promise<boolean>;
  getInboxPreview(): Promise<{ sender: string; text: string }[]>;
  summarizeInbox(): Promise<{ text: string; ai: boolean; note?: string }>;
  composeText(m: { notes: string; kind: "email" | "message"; tone: "professional" | "casual" }): Promise<string>;
};

export type AutopilotMode = "off" | "selected" | "draft";
export type AutopilotDraft = { sender: string; app: string; message: string; reply: string; warning: string; canSend: boolean };
export type AutopilotContact = { name: string; kind: "friend" | "professional" };
export type Autopilot = {
  mode: AutopilotMode; reply: boolean; defaultKind: "friend" | "professional"; paused: boolean;
  digestMinutes: number; notificationAccess: boolean; listenerConnected: boolean; apps: string[]; contacts: AutopilotContact[];
};
export type AutopilotChange = Omit<Autopilot, "notificationAccess" | "listenerConnected" | "apps">;
export type AutopilotLogEntry = { t: number; action: "drafted" | "handed" | "dismissed" | "skipped" | "error"; sender: string; note: string; reply: string };

// Only Android has the keyboard. Elsewhere (iOS, web) and in Expo Go (no native module) everything is a safe no-op.
const native: Native | null = Platform.OS === "android" ? requireOptionalNativeModule<Native>("AzLinqext") : null;

export const keyboardSupported = native !== null;

export const getStatus = async (): Promise<KeyboardStatus> => native ? native.getStatus() : { enabled: false, selected: false, linked: false, linkedUserId: null };
export const linkedUserId = (): string | null => native?.linkedUserId() ?? null;
export const unlinkKeyboard = async (): Promise<void> => { if (native) await native.unlinkKeyboard(); };
export const openKeyboardSettings = async (): Promise<void> => { if (native) await native.openKeyboardSettings(); };
export const showKeyboardPicker = async (): Promise<void> => { if (native) await native.showKeyboardPicker(); };

export type KeyboardLink = {
  apiUrl: string; allowHttp: boolean; installId: string; userId: string; displayName: string;
  accessToken: string; accessExpiresInSeconds: number; refreshToken: string; refreshExpiresAt: string;
};
export const linkKeyboard = async (l: KeyboardLink): Promise<void> => {
  if (native) await native.linkKeyboard(l);
};

const AUTOPILOT_OFF: Autopilot = { mode: "off", reply: true, defaultKind: "friend", paused: false, digestMinutes: 0, notificationAccess: false, listenerConnected: false, apps: [], contacts: [] };
export const getAutopilot = async (): Promise<Autopilot> => native ? native.getAutopilot() : AUTOPILOT_OFF;
export const setAutopilot = async (change: Partial<AutopilotChange>): Promise<void> => { if (native) await native.setAutopilot(change); };
export const getAutopilotLog = async (): Promise<AutopilotLogEntry[]> => native ? native.getAutopilotLog() : [];
export const clearAutopilotLog = async (): Promise<void> => { if (native) await native.clearAutopilotLog(); };
export const openNotificationAccess = async (): Promise<void> => { if (native) await native.openNotificationAccess(); };
export const openAppInfo = async (): Promise<void> => { if (native) await native.openAppInfo(); };
export const summarizeInbox = async () => native ? native.summarizeInbox() : { text: "Not available on this device.", ai: false };
export const composeText = async (m: { notes: string; kind: "email" | "message"; tone: "professional" | "casual" }): Promise<string> => {
  if (!native) throw new Error("Writing is available in the Android app.");
  return native.composeText(m);
};
export const getDraft = async (id: number): Promise<AutopilotDraft | null> => native ? native.getDraft(id) : null;
export const sendDraft = async (id: number, text: string): Promise<boolean> => native ? native.sendDraft(id, text) : false;
export const dismissDraft = async (id: number): Promise<void> => { if (native) await native.dismissDraft(id); };
export const getInboxPreview = async () => native ? native.getInboxPreview() : [];
