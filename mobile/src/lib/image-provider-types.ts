export type ProviderStatus = "skipped" | "not_configured" | "unavailable";
export type Classification =
  | { status: "checked"; provider: "sightengine"; model: "genai"; modelVersion: "provider-managed"; score: number; label: "LIKELY_AI" | "LOW_AI_SIGNAL" | "INCONCLUSIVE"; calibrated: false; checkedAt: string }
  | { status: ProviderStatus; provider: "sightengine"; reason: string };
export type WebMatch = {
  url: string; platform: string; kind: "matching_page" | "full_image" | "partial_image";
};
export type Discovery =
  | { status: "checked"; provider: "google_vision"; checkedAt: string; scope: "provider_public_index"; matches: WebMatch[] }
  | { status: ProviderStatus; provider: "google_vision"; reason: string };
export type ImageConsent = { googleGemini: boolean; sightengine: boolean; googleVision: boolean };
