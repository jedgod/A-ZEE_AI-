import { handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { classifierReady, discoveryReady } from "@/lib/vision/providers";
import { geminiVisionReady } from "@/lib/vision/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated provider availability, evidence coverage and independent consent fields. Never returns keys. */
export function GET(request: Request) {
  return handle(async () => {
    await sidebarOwner(request);
    return Response.json({ data: {
      googleAi: geminiVisionReady(),
      signedProvenance: true,
      copySearch: { scope: "configured_local_index", configured: !!process.env.AZ_IMAGE_INDEX_FILE },
      aiLikelihoodEstimator: { supported: true, configured: classifierReady(), provider: "sightengine", calibrated: false },
      internetSearch: { supported: true, configured: discoveryReady(), provider: "google_vision", scope: "provider_public_index" },
      platformDiscovery: { supported: true, mode: "public_result_domain_labels", directPlatformAccess: false, exhaustive: false, privateContent: false },
      externalConsent: { fields: { google_gemini: "googleConsent", sightengine: "classifierConsent", google_vision: "discoveryConsent" }, perImage: true, default: false },
    } }, { headers: NO_STORE });
  });
}
