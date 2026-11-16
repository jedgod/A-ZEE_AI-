package expo.modules.azlinqext.autopilot

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** The user's autopilot choices and the activity log. Stored privately on the phone; nothing here is sent anywhere. */
class AutopilotStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("azlinqext_autopilot", Context.MODE_PRIVATE)

    fun load(): AutopilotSettings = try { AutopilotSettings.parse(prefs.getString("settings", null)?.let(::JSONObject)) } catch (_: Exception) { AutopilotSettings() }
    fun save(settings: AutopilotSettings) { prefs.edit().putString("settings", settings.toJson().toString()).apply() }

    /** What it did, so the user can always check. Holds the reply text (the user's own words) and who it was for, never the incoming message. */
    @Synchronized fun log(action: String, sender: String, note: String = "", reply: String = "") {
        val entries = readLog()
        val entry = JSONObject().put("t", System.currentTimeMillis()).put("action", action).put("sender", sender.take(80)).put("note", note.take(120)).put("reply", reply.take(400))
        val next = JSONArray().put(entry)
        for (i in 0 until minOf(entries.length(), MAX_LOG - 1)) next.put(entries.getJSONObject(i))
        prefs.edit().putString("log", next.toString()).apply()
    }

    fun readLog(): JSONArray = try { JSONArray(prefs.getString("log", "[]")) } catch (_: Exception) { JSONArray() }
    fun clearLog() { prefs.edit().remove("log").apply() }

    /** When the last check-in was posted, so the next one reports only what is new. */
    var lastDigestMs: Long
        get() = prefs.getLong("lastDigest", 0L)
        set(value) { prefs.edit().putLong("lastDigest", value).apply() }

    companion object {
        const val MAX_LOG = 100
        @Volatile private var instance: AutopilotStore? = null
        fun get(context: Context): AutopilotStore = instance ?: synchronized(this) { instance ?: AutopilotStore(context).also { instance = it } }
    }
}

/** The latest incoming messages, kept in memory only (never written to disk) for the check-in summary. Gone when the app process ends. */
object RecentInbox {
    data class Item(val sender: String, val text: String, val timeMs: Long)
    private val items = ArrayDeque<Item>()

    @Synchronized fun add(sender: String, text: String, timeMs: Long) {
        items.addLast(Item(sender, text.take(300), timeMs))
        while (items.size > 40) items.removeFirst()
    }
    @Synchronized fun all(): List<Item> = items.toList()
    @Synchronized fun since(ms: Long): List<Item> = items.filter { it.timeMs >= ms }
    @Synchronized fun clear() = items.clear()

    /** A plain digest without any AI: who wrote, how many times, and the latest line from each. */
    fun digest(list: List<Item>): String {
        if (list.isEmpty()) return "No new messages."
        val bySender = LinkedHashMap<String, MutableList<Item>>()
        list.forEach { bySender.getOrPut(it.sender) { mutableListOf() }.add(it) }
        return bySender.entries.joinToString("\n") { (who, msgs) -> "$who (${msgs.size}): ${msgs.last().text.take(120)}" }
    }
}
