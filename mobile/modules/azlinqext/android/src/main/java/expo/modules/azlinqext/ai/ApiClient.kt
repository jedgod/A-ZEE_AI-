package expo.modules.azlinqext.ai

import expo.modules.azlinqext.store.KeyboardStore
import org.json.JSONObject
import java.io.IOException

/**
 * Talks to the A-Zee server as the keyboard. It uses only the keyboard's own scoped link: a
 * 15-minute access token, renewed with a rotating refresh token. It never sees the app's session.
 */
class ApiClient(
    private val store: KeyboardStore,
    private val transport: HttpTransport = UrlConnectionTransport(),
    private val now: () -> Long = System::currentTimeMillis,
    private val retryDelayMs: Long = 400,
) {
    private val refreshLock = Any()

    fun entitlements(): Entitlements {
        val json = authorized("GET", "/api/linqext/entitlements", null, 8_000)
        val parsed = Entitlements.parse(json)
        store.saveEntitlements(json.toString())
        return parsed
    }

    /** Asks for a reply. One retry after a network failure reuses the same requestId, so the server answers it once and charges once. */
    fun reply(request: ReplyRequest): ReplyResult {
        val body = JSONObject()
            .put("requestId", request.requestId).put("message", request.message).put("tone", request.tone)
            .put("variants", request.variants).put("consent", true).put("trigger", request.trigger).toString()
        val json = try {
            authorized("POST", "/api/linqext/replies", body, 20_000)
        } catch (e: ApiFailure.Offline) {
            Thread.sleep(retryDelayMs)
            authorized("POST", "/api/linqext/replies", body, 20_000)
        }
        val replies = json.getJSONArray("replies")
        return ReplyResult(json.getString("tier"), (0 until replies.length()).map { replies.getString(it) }.filter { it.isNotBlank() })
    }

    /** Best effort: tell the server this keyboard is signed out. Local credentials are cleared either way. */
    fun unlink() {
        try { authorized("POST", "/api/linqext/keyboard/unlink", "{}", 5_000) } catch (_: Exception) { }
        store.clearLink()
    }

    private fun authorized(method: String, path: String, body: String?, timeoutMs: Int): JSONObject {
        val link = store.link() ?: throw ApiFailure.NotLinked()
        if (link.refreshExpiresAtMs <= now()) { store.clearLink(); throw ApiFailure.NotLinked() }
        var token = if (link.accessExpiresAtMs - now() < EXPIRY_MARGIN_MS) refresh(link.accessToken) else link.accessToken
        var result = send(method, path, body, token, timeoutMs)
        if (result.status == 401) { // revoked, or expired earlier than we thought: renew once, then give up
            token = refresh(token)
            result = send(method, path, body, token, timeoutMs)
            if (result.status == 401) { store.clearLink(); throw ApiFailure.NotLinked() }
        }
        return interpret(result)
    }

    private fun send(method: String, path: String, body: String?, token: String, timeoutMs: Int): HttpResult {
        val link = store.link() ?: throw ApiFailure.NotLinked()
        val base = link.apiUrl.trimEnd('/')
        require(base.startsWith("https://") || link.allowHttp) { "The server address must use HTTPS" }
        val headers = mutableMapOf("Authorization" to "Bearer $token", "X-AZ-Client" to "mobile", "Accept" to "application/json")
        store.load().installId?.let { headers["X-AZ-Device"] = it }
        if (body != null) headers["Content-Type"] = "application/json"
        return try { transport.execute(method, base + path, headers, body, timeoutMs) } catch (e: IOException) { throw ApiFailure.Offline() }
    }

    /** Renews the credentials once, even if several calls need it at the same time. [failedAccessToken] is the one that just stopped working. */
    private fun refresh(failedAccessToken: String): String = synchronized(refreshLock) {
        val link = store.link() ?: throw ApiFailure.NotLinked()
        // Another call may already have renewed it while this one waited for the lock.
        if (link.accessToken != failedAccessToken && link.accessExpiresAtMs - now() >= EXPIRY_MARGIN_MS) return link.accessToken
        val base = link.apiUrl.trimEnd('/')
        require(base.startsWith("https://") || link.allowHttp) { "The server address must use HTTPS" }
        val headers = mapOf("X-AZ-Client" to "mobile", "Content-Type" to "application/json", "Accept" to "application/json")
        val result = try {
            transport.execute("POST", "$base/api/linqext/keyboard/refresh", headers, JSONObject().put("refreshToken", link.refreshToken).toString(), 8_000)
        } catch (e: IOException) { throw ApiFailure.Offline() }
        if (result.status == 401) { store.clearLink(); throw ApiFailure.NotLinked() } // revoked, signed out, or replayed: reconnect in the app
        if (result.status !in 200..299) throw ApiFailure.Server(result.status)
        val data = JSONObject(result.body).getJSONObject("data")
        val expiresAt = now() + data.getLong("accessExpiresInSeconds") * 1000
        val refreshExpiresAt = parseIsoMillis(data.getString("refreshExpiresAt"))
        store.updateTokens(data.getString("accessToken"), expiresAt, data.getString("refreshToken"), refreshExpiresAt)
        data.getString("accessToken")
    }

    private fun interpret(result: HttpResult): JSONObject {
        val json = try { JSONObject(result.body) } catch (_: Exception) { JSONObject() }
        if (result.status in 200..299) return json.optJSONObject("data") ?: throw ApiFailure.Server(result.status)
        throw when (json.optString("error")) {
            "CONSENT_REQUIRED" -> ApiFailure.ConsentRequired()
            "FEATURE_NOT_IN_PLAN" -> ApiFailure.NotInPlan(json.optString("tier"))
            "PLAN_LIMIT_REACHED" -> ApiFailure.LimitReached()
            "REQUEST_IN_PROGRESS" -> ApiFailure.InProgress()
            "TOO_SOON", "TYPING_LIMIT_REACHED" -> ApiFailure.Paced()
            "RATE_LIMITED", "TOO_MANY_IN_FLIGHT" -> ApiFailure.TooMany()
            "INPUT_BLOCKED", "OUTPUT_BLOCKED" -> ApiFailure.Blocked()
            else -> ApiFailure.Server(result.status)
        }
    }

    companion object {
        private const val EXPIRY_MARGIN_MS = 60_000L

        /** Parses the server's `2026-01-31T12:00:00.000Z` timestamps (java.time needs Android 8; this works on 7). */
        fun parseIsoMillis(value: String): Long {
            val format = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            return format.parse(value)!!.time
        }
    }
}
