/** The ten translation languages. `code` is what the server accepts; `speechLocale` is the voice used to read the result aloud. */
export type LanguageOption = { code: string; label: string; nativeLabel: string; speechLocale: string; fallbackSpeechLocale?: string };

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "en", label: "English", nativeLabel: "English", speechLocale: "en-US" },
  { code: "de", label: "German", nativeLabel: "Deutsch", speechLocale: "de-DE" },
  { code: "nl", label: "Dutch (Holland)", nativeLabel: "Nederlands", speechLocale: "nl-NL" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी", speechLocale: "hi-IN" },
  { code: "sw", label: "Swahili", nativeLabel: "Kiswahili", speechLocale: "sw-KE" },
  { code: "ru", label: "Russian", nativeLabel: "Русский", speechLocale: "ru-RU" },
  { code: "zh", label: "Chinese (Mandarin)", nativeLabel: "中文", speechLocale: "zh-CN" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語", speechLocale: "ja-JP" },
  { code: "tw", label: "Twi (Akan)", nativeLabel: "Twi / Akan", speechLocale: "ak-GH", fallbackSpeechLocale: "en-GH" },
  { code: "ee", label: "Ewe", nativeLabel: "Eʋegbe", speechLocale: "ee-GH", fallbackSpeechLocale: "en-GH" },
];
