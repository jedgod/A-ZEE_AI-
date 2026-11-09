package expo.modules.azlinqext.ai

/**
 * The messaging apps where the AI bar appears. In every other app (including A-Zee itself) AZLinqext is just a plain
 * keyboard: no bar, no reading of text, no network calls. Matching is exact on the package name the app reports, so a
 * look-alike package never qualifies.
 */
object SupportedApps {
    val packages: Set<String> = setOf(
        "com.whatsapp", "com.whatsapp.w4b",                                        // WhatsApp, WhatsApp Business
        "com.linkedin.android", "com.linkedin.android.lite",                       // LinkedIn, LinkedIn Lite
        "org.telegram.messenger", "org.telegram.messenger.web", "org.thunderdog.challegram", // Telegram, Telegram (web build), Telegram X
        "org.thoughtcrime.securesms",                                              // Signal
    )

    fun supports(packageName: String?): Boolean = packageName != null && packageName in packages
}
