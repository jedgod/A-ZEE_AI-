package expo.modules.azlinqext.ime

import android.content.Context

/** Small, non-sensitive keyboard preferences (kept on the device only). */
class KeyboardPrefs(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("azlinqext_prefs", Context.MODE_PRIVATE)

    /** The user collapsed the AI bar. While it is hidden the keyboard reads no text and asks for no suggestions. */
    var barHidden: Boolean
        get() = prefs.getBoolean("barHidden", false)
        set(value) { prefs.edit().putBoolean("barHidden", value).apply() }
}
