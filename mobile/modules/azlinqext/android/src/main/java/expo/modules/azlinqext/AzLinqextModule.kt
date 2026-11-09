package expo.modules.azlinqext

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import expo.modules.azlinqext.ime.AzKeyboardService
import expo.modules.azlinqext.ai.ApiClient
import expo.modules.azlinqext.store.KeyboardStore
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The bridge between the A-Zee app and its AZLinqext keyboard. It hands the keyboard a narrowly scoped,
 * short-lived credential (never the app's own session) and helps the user switch the keyboard on.
 * Credentials go straight into the keyboard's encrypted store and are never returned to JavaScript.
 */
class AzLinqextModule : Module() {
    private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    private val store by lazy { KeyboardStore.forContext(context) }
    private val imeId: String get() = ComponentName(context, AzKeyboardService::class.java).flattenToShortString()

    override fun definition() = ModuleDefinition {
        Name("AzLinqext")

        AsyncFunction("getStatus") {
            val manager = context.getSystemService(InputMethodManager::class.java)
            val snapshot = store.load()
            val enabled = manager?.enabledInputMethodList?.any { it.id == imeId } == true
            val selected = Settings.Secure.getString(context.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD) == imeId
            mapOf(
                "enabled" to enabled,
                "selected" to selected,
                "linked" to (snapshot.link != null),
                "linkedUserId" to snapshot.link?.userId,
            )
        }

        /** Stores the keyboard's credentials. The access and refresh tokens come from POST /api/linqext/keyboard/link. */
        AsyncFunction("linkKeyboard") { link: Map<String, Any?> ->
            // One map, not nine positional arguments: the Expo bridge supports far fewer parameters than that.
            fun text(key: String) = link[key] as? String ?: throw IllegalArgumentException("missing $key")
            val apiUrl = text("apiUrl"); val installId = text("installId"); val userId = text("userId")
            val accessToken = text("accessToken"); val refreshToken = text("refreshToken")
            val allowHttp = link["allowHttp"] as? Boolean ?: false
            val accessExpiresInSeconds = (link["accessExpiresInSeconds"] as? Number)?.toDouble() ?: throw IllegalArgumentException("missing accessExpiresInSeconds")
            require(apiUrl.startsWith("https://") || allowHttp) { "The server address must use HTTPS" }
            require(Regex("^[a-f0-9]{32}$").matches(installId)) { "bad install id" }
            require(accessToken.startsWith("azk_") && refreshToken.startsWith("azr_")) { "Not a keyboard credential" } // an app session can never be stored here
            store.saveInstallId(installId)
            store.saveLink(KeyboardStore.Link(
                apiUrl = apiUrl.trimEnd('/'), allowHttp = allowHttp, userId = userId, displayName = link["displayName"] as? String ?: "",
                accessToken = accessToken, accessExpiresAtMs = System.currentTimeMillis() + (accessExpiresInSeconds * 1000).toLong(),
                refreshToken = refreshToken, refreshExpiresAtMs = ApiClient.parseIsoMillis(text("refreshExpiresAt")),
            ))
            true
        }

        /** Signs the keyboard out on this device (the app also revokes the link on the server). */
        AsyncFunction("unlinkKeyboard") {
            store.clearLink()
            true
        }

        Function("linkedUserId") { store.load().link?.userId }

        AsyncFunction("openKeyboardSettings") {
            context.startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        }

        AsyncFunction("showKeyboardPicker") {
            context.getSystemService(InputMethodManager::class.java)?.showInputMethodPicker()
            true
        }
    }
}
