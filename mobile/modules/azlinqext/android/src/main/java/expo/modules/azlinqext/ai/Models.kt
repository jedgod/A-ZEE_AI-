package expo.modules.azlinqext.ai

import org.json.JSONArray
import org.json.JSONObject

data class Features(val context: Int, val variants: Int, val maxWords: Int, val tones: List<String>, val personalized: Boolean)
data class Usage(val used: Int, val limit: Int?, val remaining: Int?, val resetsAt: String?)
data class ConsentState(val version: Int, val replyAssist: Boolean, val context: Boolean, val current: Boolean, val typing: Boolean = false)

/** What the server says this account may do, from its real A-Zee plan. The keyboard never decides a tier itself. */
data class Entitlements(val tier: String, val plan: String, val features: Features, val usage: Usage, val consent: ConsentState) {
    companion object {
        fun parse(data: JSONObject): Entitlements {
            val f = data.getJSONObject("features")
            val u = data.getJSONObject("usage")
            val c = data.getJSONObject("consent")
            return Entitlements(
                tier = data.getString("tier"),
                plan = data.optString("plan", data.getString("tier")),
                features = Features(f.getInt("context"), f.getInt("variants"), f.getInt("maxWords"), f.getJSONArray("tones").strings(), f.optBoolean("personalized")),
                usage = Usage(
                    u.getInt("used"),
                    if (u.isNull("limit")) null else u.getInt("limit"),
                    if (u.isNull("remaining")) null else u.getInt("remaining"),
                    u.optString("resetsAt").ifEmpty { null },
                ),
                consent = ConsentState(c.getInt("version"), c.getBoolean("replyAssist"), c.getBoolean("context"), c.getBoolean("current"), c.optBoolean("typing")),
            )
        }
    }
}

private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }

/** [trigger] is "tap" (the user pressed Suggest) or "typing" (asked after a pause; needs its own consent). */
data class ReplyRequest(val requestId: String, val message: String, val tone: String, val variants: Int, val trigger: String = "tap")
data class ReplyResult(val tier: String, val replies: List<String>)

/** Every way a call can fail, with a message that is safe and useful to show on the keyboard. */
sealed class ApiFailure(val code: String, message: String) : Exception(message) {
    class NotLinked : ApiFailure("NOT_LINKED", "Open A-Zee to connect the keyboard")
    class ConsentRequired : ApiFailure("CONSENT_REQUIRED", "Turn on AI replies in the A-Zee app first")
    class NotInPlan(val tier: String) : ApiFailure("FEATURE_NOT_IN_PLAN", "That option isn't included in your plan")
    class LimitReached : ApiFailure("PLAN_LIMIT_REACHED", "You've used this month's replies")
    class InProgress : ApiFailure("REQUEST_IN_PROGRESS", "Still working on that one...")
    class TooMany : ApiFailure("RATE_LIMITED", "Too many requests. Wait a moment")
    /** Typing-triggered suggestions the server held back (too soon, or the daily cap). Shown quietly, if at all. */
    class Paced : ApiFailure("PACED", "Suggestions are paused for a moment")
    class Blocked : ApiFailure("BLOCKED", "I can't help with that message")
    class Offline : ApiFailure("OFFLINE", "Can't reach A-Zee. Check your connection")
    class Server(val status: Int) : ApiFailure("SERVER", "A-Zee is unavailable right now. Try again")
}
