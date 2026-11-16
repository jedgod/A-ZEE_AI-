import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

export type CameraPhoto = { uri: string; width: number; height: number; size: number };
type Native = { takePhoto(): Promise<CameraPhoto | null> };

const native: Native | null = Platform.OS === "android" ? requireOptionalNativeModule<Native>("AzCamera") : null;

/** True when this build of the app includes the camera module (an older build does not). */
export const cameraAvailable = () => !!native;

/**
 * Opens the phone's camera app and resolves the photo as a file in the app's private storage, or null if the user cancels.
 * Throws if the build has no camera module, no camera app exists, or the camera cannot be opened.
 */
export async function takePhoto(): Promise<CameraPhoto | null> {
  if (!native) throw new Error("The camera needs the latest version of the app. Rebuild it and try again.");
  return native.takePhoto();
}
