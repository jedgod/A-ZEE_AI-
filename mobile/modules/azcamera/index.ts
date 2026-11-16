import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

export type CameraPhoto = { uri: string; width: number; height: number; size: number };
export type SharedImage = { uri: string; name: string; mime: string; size: number };
type Subscription = { remove(): void };
type Native = {
  takePhoto(): Promise<CameraPhoto | null>;
  consumeSharedImage(): Promise<SharedImage | null>;
  addListener(event: "onShare", listener: () => void): Subscription;
};

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

/**
 * A picture another app shared to "A-Zee Image Verify", copied into the app's private storage, or null when nothing is waiting.
 * Each share is returned once. Resolves null on a build without the module.
 */
export async function consumeSharedImage(): Promise<SharedImage | null> {
  return native ? native.consumeSharedImage() : null;
}

/** Calls back when a picture is shared while the app is already open. Returns a function that stops listening. */
export function onSharedImage(listener: () => void): () => void {
  if (!native) return () => undefined;
  const sub = native.addListener("onShare", listener);
  return () => sub.remove();
}
