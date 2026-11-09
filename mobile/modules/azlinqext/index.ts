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
};

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
