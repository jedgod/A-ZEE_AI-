import { Platform } from "react-native";
import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import { api } from "./api";

/**
 * Lock-screen alerts: registers this phone's Expo push token with A-Zee so price alerts can reach it when the app is closed.
 *
 * The native modules (expo-notifications, expo-device) are loaded lazily and every failure is swallowed, so a build that does not
 * include them yet (or a phone without Google services) simply does not register. Nothing here can break sign-in or the app.
 * It needs: a development/production build WITH the notification native module, google-services.json and FCM credentials on the
 * Expo project, and an EAS project id in app.json (extra.eas.projectId). See mobile/PUSH_SETUP.md.
 */
export type PushResult = "registered" | "unavailable" | "not-a-device" | "no-project-id" | "denied" | "error";

type Notifications = typeof import("expo-notifications");
type Device = typeof import("expo-device");
let registeredToken: string | null = null;

/** True only in a build that includes the notification and device native modules. Checked first because importing the JS wrapper of a missing module logs a loud (dev) error even when caught. */
const hasNativeModules = () => !!requireOptionalNativeModule("ExpoPushTokenManager") && !!requireOptionalNativeModule("ExpoDevice");

function load(): { N: Notifications; D: Device } | null {
  if (!hasNativeModules()) return null;
  try { return { N: require("expo-notifications") as Notifications, D: require("expo-device") as Device }; } catch { return null; }
}

export async function registerForPush(): Promise<PushResult> {
  const m = load();
  if (!m) return "unavailable";
  try {
    const { N, D } = m;
    if (!D.isDevice) return "not-a-device";
    const projectId: string | undefined = (Constants as any).easConfig?.projectId ?? (Constants.expoConfig?.extra as any)?.eas?.projectId;
    if (!projectId) return "no-project-id";

    // Show alerts that arrive while the app is open, too.
    N.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
    // Android 8+ needs a channel for heads-up and lock-screen alerts; on Android 13+ the permission prompt waits for one.
    if (Platform.OS === "android") {
      await N.setNotificationChannelAsync("price-alerts", { name: "Price alerts", importance: N.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250], lightColor: "#1769FF" });
    }
    let status = (await N.getPermissionsAsync()).status;
    if (status !== "granted") status = (await N.requestPermissionsAsync()).status;
    if (status !== "granted") return "denied";

    const token = (await N.getExpoPushTokenAsync({ projectId })).data;
    await api("/api/notifications/push-token", { method: "POST", body: { expoPushToken: token, platform: Platform.OS === "ios" ? "ios" : "android" } });
    registeredToken = token;
    return "registered";
  } catch { return "error"; }
}

/** On sign-out: stop alerts for this account reaching this phone. */
export async function forgetPushToken(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  try { await api("/api/notifications/push-token", { method: "DELETE", body: { expoPushToken: token }, skipUnauthorized: true }); } catch { /* the server also drops dead tokens */ }
}
