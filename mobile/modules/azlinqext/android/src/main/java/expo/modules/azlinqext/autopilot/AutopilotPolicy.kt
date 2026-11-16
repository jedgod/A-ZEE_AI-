package expo.modules.azlinqext.autopilot

import org.json.JSONArray
import org.json.JSONObject

/**
 * Autopilot only ever drafts. A draft opens in a review screen, and nothing is handed to a chat app until the user taps Send there.
 * OFF: nothing. SELECTED: draft only for the conversations the user listed. DRAFT: draft for every supported one-to-one conversation.
 * (Older saved choices of "everyone" are read as DRAFT, so an upgrade can never leave anything sending by itself.)
 */
enum class AutopilotMode(val key: String) {
    OFF("off"), SELECTED("selected"), DRAFT("draft");
    companion object { fun of(key: String?) = values().firstOrNull { it.key == key } ?: if (key == "everyone") DRAFT else OFF }
}

data class Contact(val name: String, val kind: String) {
    /** Friends get a casual tone, professional contacts a professional one. */
    val tone: String get() = if (kind == "professional") "professional" else "casual"
}

data class AutopilotSettings(
    val mode: AutopilotMode = AutopilotMode.OFF,
    val replyToMessages: Boolean = true,
    val defaultKind: String = "friend",
    val contacts: List<Contact> = emptyList(),
    val paused: Boolean = false,
    val digestMinutes: Int = 0,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("mode", mode.key).put("reply", replyToMessages).put("defaultKind", defaultKind).put("paused", paused).put("digestMinutes", digestMinutes)
        .put("contacts", JSONArray().also { a -> contacts.forEach { a.put(JSONObject().put("name", it.name).put("kind", it.kind)) } })

    companion object {
        fun parse(json: JSONObject?): AutopilotSettings {
            if (json == null) return AutopilotSettings()
            val list = json.optJSONArray("contacts")
            val contacts = (0 until (list?.length() ?: 0)).mapNotNull { i ->
                val c = list!!.optJSONObject(i) ?: return@mapNotNull null
                val name = c.optString("name").trim().take(80)
                if (name.isEmpty()) null else Contact(name, if (c.optString("kind") == "professional") "professional" else "friend")
            }.distinctBy { AutopilotPolicy.norm(it.name) }.take(200)
            return AutopilotSettings(
                mode = AutopilotMode.of(json.optString("mode")), replyToMessages = json.optBoolean("reply", true),
                defaultKind = if (json.optString("defaultKind") == "professional") "professional" else "friend",
                contacts = contacts, paused = json.optBoolean("paused", false),
                digestMinutes = json.optInt("digestMinutes", 0).let { if (it in listOf(15, 30, 60, 120, 240)) it else 0 },
            )
        }
    }
}

data class Incoming(val sender: String, val text: String, val isGroup: Boolean)

sealed class Decision {
    /** Do nothing, and do not send the text anywhere. */
    data class Ignore(val reason: String) : Decision()
    /** Write a reply and show it for the user to review. */
    data class Draft(val tone: String, val reason: String = "") : Decision()
}

object AutopilotPolicy {
    const val MAX_MESSAGE_CHARS = 1000

    fun norm(s: String) = s.lowercase().filter { it.isLetterOrDigit() }

    private val CODE = Regex("""\b\d{4,8}\b""")
    private val CODE_WORDS = Regex("""(?i)\b(otp|one[- ]time|verification|verify|security code|passcode|pin|2fa|login code|confirm(?:ation)? code)\b""")
    private val SENSITIVE = Regex("""(?i)\b(password|passcode|cvv|ssn|social security|card number|account number|routing number|iban|swift|wire transfer|send money|bitcoin|crypto wallet|seed phrase|loan|bail|arrest|lawyer|legal action|diagnos\w*|prescription|suicid\w*|emergency|urgent help)\b""")

    /** Texts that must never be processed: codes, credentials, money, legal, medical, crisis. */
    fun sensitive(text: String): Boolean = (CODE.containsMatchIn(text) && CODE_WORDS.containsMatchIn(text)) || SENSITIVE.containsMatchIn(text)

    private val SUMMARY = Regex("""(?i)^\d+ (new )?messages?\b|^\d+ messages? from \d+ chats?|^checking for new messages|^new messages$""")

    fun contactFor(settings: AutopilotSettings, sender: String): Contact? {
        val n = norm(sender)
        return if (n.isEmpty()) null else settings.contacts.firstOrNull { norm(it.name) == n }
    }

    fun decide(settings: AutopilotSettings, msg: Incoming): Decision {
        if (settings.mode == AutopilotMode.OFF || settings.paused || !settings.replyToMessages) return Decision.Ignore("off")
        val text = msg.text.trim()
        if (msg.sender.isBlank() || text.length < 2 || SUMMARY.containsMatchIn(text)) return Decision.Ignore("not a message")
        if (sensitive(text)) return Decision.Ignore("sensitive")
        val contact = contactFor(settings, msg.sender)
        if (settings.mode == AutopilotMode.SELECTED && contact == null) return Decision.Ignore("not selected")
        if (msg.isGroup) return Decision.Ignore("group chat")
        val tone = (contact?.kind ?: settings.defaultKind).let { if (it == "professional") "professional" else "casual" }
        return Decision.Draft(tone)
    }

    private val NUM = Regex("""\d[\d:.,/-]*""")
    private val LINK = Regex("""(?i)https?://|www\.|[\w.+-]+@[\w-]+\.""")
    private fun clean(s: String) = s.trim('.', ',', ':', '-', '/')

    /**
     * True when a draft repeats only numbers, dates and links that are in the message it answers. When false the review
     * screen warns "this mentions details that were not in their message", so the user checks them before sending.
     */
    fun draftAddsNoDetails(message: String, reply: String): Boolean {
        if (reply.isBlank() || reply.length > 600 || sensitive(reply)) return false
        val seen = NUM.findAll(message).map { clean(it.value) }.toSet()
        if (NUM.findAll(reply).any { clean(it.value) !in seen }) return false
        return !(LINK.containsMatchIn(reply) && !LINK.containsMatchIn(message))
    }
}
