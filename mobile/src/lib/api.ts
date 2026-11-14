import { API_CONFIGURED, API_URL } from "./config";
import { getInstallId, loadToken } from "./storage";

// One place for every call to the A-Zee server. It adds the headers the server expects from the
// app (X-AZ-Client, a device id, the Bearer session), turns error codes into plain messages, and
// reports a 401 so the app can send the user back to sign-in.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  REGISTRATION_FAILED: "We couldn't create that account. Try signing in, or use a different email.",
  WEAK_PASSWORD: "Use at least 12 characters and avoid repeating the same few characters.",
  INVALID_INPUT: "Check what you entered and try again.",
  EMAIL_NOT_CONFIGURED: "Email isn't set up on the server yet, so accounts can't be created.",
  WRONG_PASSWORD: "That password is incorrect.",
  SIGN_IN_REQUIRED: "Please sign in to continue.",
  UPGRADE_REQUIRED: "This needs a paid plan.",
  PLAN_LIMIT_REACHED: "You've reached this month's limit on your plan.",
  INPUT_BLOCKED: "That message can't be sent.",
  OUTPUT_BLOCKED: "That answer was blocked. Try rephrasing.",
  AI_PROVIDER_UNAVAILABLE: "The AI service is unavailable right now. Try again soon.",
  AI_PROVIDER_NOT_CONFIGURED: "The AI service isn't set up on the server yet.",
  SERVICE_UNAVAILABLE: "The service is unavailable right now. Try again soon.",
  PAYMENT_PROVIDER_ERROR: "We couldn't remove your saved payment methods. Nothing was deleted; try again.",
  CHAT_NOT_FOUND: "That chat wasn't found.",
  TOO_MANY_METHODS: "Too many saved items.",
  LIBRARY_FULL: "Your prompt library is full.",
  FILE_TOO_LARGE: "That file is too large (the limit is 8 MB).",
  UNSUPPORTED_FORMAT: "That file type isn't supported. Use a PDF, Word (.docx), CSV or text file.",
  UNREADABLE_DOCUMENT: "That file couldn't be read. It may be damaged or password-protected.",
  NO_TEXT_FOUND: "No text was found in that file. A scanned PDF with no text layer can't be read yet.",
  EMPTY_FILE: "That file is empty.",
  DAILY_VIDEO_LIMIT: "You've reached today's limit for real video generations. Try again tomorrow.",
  EXTERNAL_DATA_DISABLED: "This server is in private mode, so videos can't be uploaded.",
  STORAGE_NOT_CONFIGURED: "Video upload isn't set up on the server yet.",
  UNSUPPORTED_VIDEO: "Use an MP4, MOV or WebM video.",
  VIDEO_TOO_LARGE: "That video is too large (the limit is 50 MB).",
  TOO_MANY_UPLOADS: "You already have clips waiting. Finish or wait for those edits first.",
  UPLOAD_FAILED: "The video couldn't be uploaded. Try again.",
  SOURCE_NOT_FOUND: "That clip is no longer available. Choose it again.",
  DAILY_LIMIT_REACHED: "You've used today's AZTrade AI questions. Try again tomorrow.",
  FEATURE_DISABLED: "AZTrade AI isn't turned on for this server.",
  SESSION_REVOKED: "Your AZTrade session ended. Reopen AZTrade to continue.",
  AI_UNAVAILABLE: "The AI service is unavailable right now. Try again soon.",
  AZTRADE_UNAVAILABLE: "AZTrade isn't set up on this server yet.",
  TOO_MANY_JOBS: "You already have 3 videos rendering. Wait for one to finish.",
};

let onUnauthorized: (() => void) | null = null;
/** The auth provider registers this so any 401 signs the user out in one place. */
export const setUnauthorizedHandler = (handler: (() => void) | null) => { onUnauthorized = handler; };

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown; token?: string | null; signal?: AbortSignal; skipUnauthorized?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  if (!API_CONFIGURED) throw new ApiError(0, "NOT_CONFIGURED", "The app isn't connected to a server. Set EXPO_PUBLIC_API_URL and rebuild.");
  const token = options.token === undefined ? await loadToken() : options.token;
  const headers: Record<string, string> = { "X-AZ-Client": "mobile", "X-AZ-Device": await getInstallId(), Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  Object.assign(headers, options.headers);
  // A FormData upload sets its own multipart Content-Type (with the boundary); everything else is JSON.
  const multipart = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body !== undefined && !multipart) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET", headers, signal: options.signal,
      body: options.body === undefined ? undefined : multipart ? (options.body as FormData) : JSON.stringify(options.body),
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "OFFLINE", "Can't reach A-Zee. Check your connection and try again.");
  }

  const json = await response.json().catch(() => ({}));
  if (response.ok) return (json?.data ?? json) as T;
  const code = typeof json?.error === "string" ? json.error : "ERROR";
  if (response.status === 401 && token && !options.skipUnauthorized) onUnauthorized?.();
  throw new ApiError(response.status, code, MESSAGES[code] ?? "Something went wrong. Try again.");
}
