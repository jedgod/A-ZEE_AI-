import type { LanguageOption } from "./languages";

type VoiceLister = { getAvailableVoicesAsync?: () => Promise<{ language: string }[]> };

/**
 * Picks a voice language the phone really has. Twi and Ewe voices are rarely installed, so those fall back to
 * Ghanaian English, then US English, instead of the speech engine failing silently.
 */
export async function resolveAvailableSpeechLocale(speech: VoiceLister | null, lang: LanguageOption): Promise<string> {
  if (!speech?.getAvailableVoicesAsync) return lang.fallbackSpeechLocale ?? lang.speechLocale;
  try {
    // Android reports locales with either "-" or "_" (for example "ak_GH"), so both are compared in one form.
    const norm = (s: string) => s.toLowerCase().replace("_", "-");
    const installed = new Set((await speech.getAvailableVoicesAsync()).map(v => norm(v.language)));
    if (installed.has(norm(lang.speechLocale))) return lang.speechLocale;
    if (lang.fallbackSpeechLocale && installed.has(norm(lang.fallbackSpeechLocale))) return lang.fallbackSpeechLocale;
  } catch { /* the voice list is optional */ }
  return "en-US";
}
