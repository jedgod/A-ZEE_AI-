package expo.modules.azlinqext

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import expo.modules.azlinqext.ime.AzKeyboardService
import expo.modules.azlinqext.ai.ApiClient
import expo.modules.azlinqext.ai.ApiFailure
import expo.modules.azlinqext.ai.ReplyRequest
import expo.modules.azlinqext.autopilot.AutopilotSettings
import expo.modules.azlinqext.autopilot.AutopilotStore
import expo.modules.azlinqext.autopilot.Contact
import expo.modules.azlinqext.autopilot.AutopilotMode
import expo.modules.azlinqext.autopilot.RecentInbox
import expo.modules.azlinqext.autopilot.Scheduler
import java.util.UUID
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

        // ---- Autopilot: read, reply to and summarise messages for the user, only as far as they chose ----

        AsyncFunction("getAutopilot") {
            val a = AutopilotStore.get(context)
            val s = a.load()
            val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")?.contains(context.packageName) == true
            mapOf(
                "mode" to s.mode.key, "reply" to s.replyToMessages, "defaultKind" to s.defaultKind, "paused" to s.paused,
                "digestMinutes" to s.digestMinutes, "notificationAccess" to enabled, "listenerConnected" to expo.modules.azlinqext.autopilot.AzNotificationListener.connected,
                "apps" to expo.modules.azlinqext.autopilot.AutopilotApps.labels.values.distinct(),
                "contacts" to s.contacts.map { mapOf("name" to it.name, "kind" to it.kind) },
            )
        }

        AsyncFunction("setAutopilot") { m: Map<String, Any?> ->
            val a = AutopilotStore.get(context)
            val old = a.load()
            val contacts = (m["contacts"] as? List<*>)?.mapNotNull { c ->
                val x = c as? Map<*, *> ?: return@mapNotNull null
                val name = (x["name"] as? String)?.trim().orEmpty()
                if (name.isEmpty()) null else Contact(name.take(80), if (x["kind"] == "professional") "professional" else "friend")
            } ?: old.contacts
            val mode = AutopilotMode.of(m["mode"] as? String ?: old.mode.key)
            val next = AutopilotSettings(
                mode = mode, replyToMessages = m["reply"] as? Boolean ?: old.replyToMessages,
                defaultKind = if (m["defaultKind"] == "professional") "professional" else if (m["defaultKind"] == "friend") "friend" else old.defaultKind,
                contacts = contacts, paused = m["paused"] as? Boolean ?: old.paused,
                digestMinutes = (m["digestMinutes"] as? Number)?.toInt() ?: old.digestMinutes,
            )
            val saved = AutopilotSettings.parse(next.toJson())
            a.save(saved)
            if (saved.mode == AutopilotMode.OFF) { RecentInbox.clear(); expo.modules.azlinqext.autopilot.Notifier.clearAll(context) }
            Scheduler.apply(context, if (saved.mode == AutopilotMode.OFF || saved.paused) 0 else saved.digestMinutes)
            true
        }

        AsyncFunction("getAutopilotLog") {
            val log = AutopilotStore.get(context).readLog()
            (0 until log.length()).map { i -> log.getJSONObject(i).let { mapOf("t" to it.optLong("t").toDouble(), "action" to it.optString("action"), "sender" to it.optString("sender"), "note" to it.optString("note"), "reply" to it.optString("reply")) } }
        }

        /** What the review screen shows: the destination app, the conversation, what they wrote and the draft. Null once it has expired. */
        AsyncFunction("getDraft") { id: Int ->
            expo.modules.azlinqext.autopilot.Notifier.peek(id)?.let {
                mapOf("sender" to it.sender, "app" to it.appLabel, "message" to it.message, "reply" to it.reply, "warning" to it.warning, "canSend" to (it.action != null))
            }
        }

        /** Hands the (possibly edited) text to the chat app. Runs only when the user taps Send on the review screen. */
        AsyncFunction("sendDraft") { id: Int, text: String -> expo.modules.azlinqext.autopilot.Notifier.reviewSend(context, id, text) }

        AsyncFunction("dismissDraft") { id: Int -> expo.modules.azlinqext.autopilot.Notifier.reviewDismiss(context, id); true }

        /** The message previews a summary would send to A-Zee's AI, so the user can see them first. */
        AsyncFunction("getInboxPreview") { RecentInbox.all().map { mapOf("sender" to it.sender, "text" to it.text) } }

        AsyncFunction("clearAutopilotLog") { AutopilotStore.get(context).clearLog(); RecentInbox.clear(); true }

        AsyncFunction("openNotificationAccess") {
            context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        }

        /** Android 13+ blocks notification access for apps installed outside the Play Store until "Allow restricted settings" is chosen here. */
        AsyncFunction("openAppInfo") {
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        }

        /** A summary of the messages that arrived since autopilot was turned on. Uses A-Zee's AI when the plan allows it, otherwise a plain list. */
        AsyncFunction("summarizeInbox") {
            val items = RecentInbox.all()
            if (items.isEmpty()) return@AsyncFunction mapOf("text" to "No new messages yet.", "ai" to false)
            val plain = RecentInbox.digest(items)
            val joined = items.joinToString("\n") { "${it.sender}: ${it.text}" }.takeLast(1900)
            try {
                val reply = ApiClient(store).reply(ReplyRequest(UUID.randomUUID().toString(), joined, "professional", 1, "tap", "summarize")).replies.firstOrNull()
                if (reply.isNullOrBlank()) mapOf("text" to plain, "ai" to false) else mapOf("text" to reply, "ai" to true)
            } catch (e: ApiFailure.NotInPlan) { mapOf("text" to plain, "ai" to false)
            } catch (e: ApiFailure) { mapOf("text" to plain, "ai" to false, "note" to (e.message ?: "")) }
        }

        /** Writes a message or email from the user's notes. Nothing is sent: the app shows it and the user chooses what to do. */
        AsyncFunction("composeText") { m: Map<String, Any?> ->
            val notes = (m["notes"] as? String)?.trim().orEmpty()
            require(notes.length in 3..1800) { "Write a few words about what the message should say" }
            val kind = if (m["kind"] == "email") "an email" else "a text message"
            val tone = (m["tone"] as? String)?.takeIf { it == "professional" || it == "casual" } ?: "professional"
            try {
                ApiClient(store).reply(ReplyRequest(UUID.randomUUID().toString(), "Write $kind. Instructions: $notes", tone, 1, "tap", "compose")).replies.firstOrNull() ?: throw IllegalStateException("No message came back")
            } catch (e: ApiFailure) { throw IllegalStateException(e.message ?: "Could not write that") }
        }

        AsyncFunction("showKeyboardPicker") {
            context.getSystemService(InputMethodManager::class.java)?.showInputMethodPicker()
            true
        }
    }
}
