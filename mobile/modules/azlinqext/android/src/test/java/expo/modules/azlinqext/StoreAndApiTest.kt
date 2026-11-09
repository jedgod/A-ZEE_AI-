package expo.modules.azlinqext

import expo.modules.azlinqext.ai.ApiClient
import expo.modules.azlinqext.ai.ApiFailure
import expo.modules.azlinqext.ai.ReplyRequest
import org.junit.Assert.*
import org.junit.Test

class KeyboardStoreTest {
    @Test fun roundTripsAndNeverWritesTokensInClear() {
        val (store, file) = tempStore()
        store.saveLink(link(access = "azk_secretaccess", refresh = "azr_secretrefresh"))
        assertEquals("azk_secretaccess", store.link()!!.accessToken)
        val raw = String(file.readBytes(), Charsets.ISO_8859_1)
        assertFalse(raw.contains("secretaccess")); assertFalse(raw.contains("secretrefresh")); assertFalse(raw.contains("api.example"))
    }
    @Test fun aDamagedFileIsDiscardedAndTreatedAsNotLinked() {
        val (store, file) = tempStore()
        store.saveLink(link())
        file.writeBytes(ByteArray(80) { 1 })
        assertNull(store.link()); assertFalse(file.exists())
    }
    @Test fun anotherAccountNeverSeesTheFirstAccountsPlan() {
        val (store, _) = tempStore()
        store.saveLink(link(user = "alice")); store.saveEntitlements("""{"tier":"premium"}""")
        store.saveLink(link(user = "bob"))
        assertNull(store.load().cachedEntitlements)
        store.saveEntitlements("""{"tier":"free"}""")
        store.saveLink(link(user = "bob", access = "azk_new"))                          // same account relinking keeps its own cache
        assertEquals("""{"tier":"free"}""", store.load().cachedEntitlements)
    }
    @Test fun signingOutErasesCredentialsAndPlanButKeepsTheRandomInstallId() {
        val (store, _) = tempStore()
        store.saveInstallId("a".repeat(32)); store.saveLink(link()); store.saveEntitlements("{}")
        store.clearLink()
        val s = store.load()
        assertNull(s.link); assertNull(s.cachedEntitlements); assertEquals("a".repeat(32), s.installId)
    }
    @Test fun refreshedTokensReplaceTheOldOnes() {
        val (store, _) = tempStore()
        store.saveLink(link()); store.updateTokens("azk_b", 5L, "azr_b", 6L)
        assertEquals(listOf("azk_b", "azr_b"), listOf(store.link()!!.accessToken, store.link()!!.refreshToken))
    }
}

class ApiClientTest {
    private fun client(vararg script: () -> expo.modules.azlinqext.ai.HttpResult, now: Long = 1_000_000, setup: (expo.modules.azlinqext.store.KeyboardStore) -> Unit = { it.saveLink(link(accessExpiresAt = now + 600_000)) }): Triple<ApiClient, FakeTransport, expo.modules.azlinqext.store.KeyboardStore> {
        val (store, _) = tempStore(); setup(store); store.saveInstallId("d".repeat(32))
        val transport = FakeTransport(script.toMutableList())
        return Triple(ApiClient(store, transport, { now }, retryDelayMs = 0), transport, store)
    }
    private val refreshOk = """{"data":{"accessToken":"azk_new","accessExpiresInSeconds":900,"refreshToken":"azr_new","refreshExpiresAt":"2030-01-01T00:00:00.000Z"}}"""
    private val replyOk = """{"data":{"requestId":"r","tier":"plus","replies":["Sure, see you then.","Works for me."],"insertRequiresUserAction":true}}"""

    @Test fun sendsOnlyTheKeyboardsOwnCredentialAndTheMobileHeaders() {
        val (api, t, _) = client(ok(replyOk))
        api.reply(ReplyRequest("rid", "can you come?", "casual", 2))
        val call = t.calls.single()
        assertEquals("https://api.example/api/linqext/replies", call.url)
        assertEquals("Bearer azk_a", call.headers["Authorization"]); assertEquals("mobile", call.headers["X-AZ-Client"]); assertEquals("d".repeat(32), call.headers["X-AZ-Device"])
        assertTrue(call.body!!.contains("\"consent\":true")); assertTrue(call.body!!.contains("\"requestId\":\"rid\""))
    }
    @Test fun renewsABeforeItExpiresAndStoresTheRotatedTokens() {
        val (api, t, store) = client(ok(refreshOk), ok(replyOk), setup = { it.saveLink(link(accessExpiresAt = 1_000_000 + 30_000)) }) // under the 60 s margin
        api.reply(ReplyRequest("rid", "hi", "casual", 1))
        assertTrue(t.calls[0].url.endsWith("/keyboard/refresh")); assertTrue(t.calls[0].body!!.contains("azr_r")); assertNull(t.calls[0].headers["Authorization"])
        assertEquals("Bearer azk_new", t.calls[1].headers["Authorization"])
        assertEquals("azr_new", store.link()!!.refreshToken)
    }
    @Test fun aRevokedAccessTokenIsRenewedOnceAndTheCallRetried() {
        val (api, t, _) = client(status(401), ok(refreshOk), ok(replyOk))
        assertEquals(2, api.reply(ReplyRequest("rid", "hi", "casual", 1)).replies.size)
        assertEquals(3, t.calls.size)
    }
    @Test fun aRevokedRefreshTokenSignsTheKeyboardOutLocally() {
        val (api, _, store) = client(status(401), status(401, """{"error":"INVALID_REFRESH"}"""))
        try { api.reply(ReplyRequest("rid", "hi", "casual", 1)); fail() } catch (e: ApiFailure.NotLinked) { }
        assertNull(store.link())
        try { api.entitlements(); fail() } catch (e: ApiFailure.NotLinked) { }
    }
    @Test fun stillUnauthorisedAfterRenewalSignsOut() {
        val (api, _, store) = client(status(401), ok(refreshOk), status(401))
        try { api.reply(ReplyRequest("rid", "hi", "casual", 1)); fail() } catch (e: ApiFailure.NotLinked) { }
        assertNull(store.link())
    }
    @Test fun anExpiredLinkNeverCallsTheServer() {
        val (api, t, store) = client(setup = { it.saveLink(link(refreshExpiresAt = 5)) })
        try { api.entitlements(); fail() } catch (e: ApiFailure.NotLinked) { }
        assertTrue(t.calls.isEmpty()); assertNull(store.link())
    }
    @Test fun aNetworkDropRetriesOnceWithTheSameRequestIdSoItIsChargedOnce() {
        val (api, t, _) = client(offline(), ok(replyOk))
        api.reply(ReplyRequest("same-id", "hi", "casual", 1))
        assertEquals(2, t.calls.size)
        assertEquals(t.calls[0].body, t.calls[1].body)
    }
    @Test fun twoNetworkDropsReportOffline() {
        val (api, _, _) = client(offline(), offline())
        try { api.reply(ReplyRequest("id", "hi", "casual", 1)); fail() } catch (e: ApiFailure.Offline) { }
    }
    @Test fun serverErrorsBecomeSpecificFailures() {
        fun failure(status: Int, error: String): ApiFailure { val (api, _, _) = client(status(status, """{"error":"$error"}""")); return try { api.reply(ReplyRequest("i", "hi", "casual", 1)); throw AssertionError() } catch (e: ApiFailure) { e } }
        assertTrue(failure(403, "CONSENT_REQUIRED") is ApiFailure.ConsentRequired)
        assertTrue(failure(403, "FEATURE_NOT_IN_PLAN") is ApiFailure.NotInPlan)
        assertTrue(failure(429, "PLAN_LIMIT_REACHED") is ApiFailure.LimitReached)
        assertTrue(failure(409, "REQUEST_IN_PROGRESS") is ApiFailure.InProgress)
        assertTrue(failure(429, "TOO_MANY_IN_FLIGHT") is ApiFailure.TooMany)
        assertTrue(failure(422, "INPUT_BLOCKED") is ApiFailure.Blocked)
        assertTrue(failure(503, "REPLY_GENERATION_UNAVAILABLE") is ApiFailure.Server)
    }
    @Test fun parsesEntitlementsAndCachesThemForOfflineDisplay() {
        val (api, _, store) = client(ok("""{"data":$ENTITLEMENTS_JSON}"""))
        val e = api.entitlements()
        assertEquals("plus", e.tier); assertEquals(4988, e.usage.remaining); assertEquals(3, e.features.variants); assertTrue(e.consent.replyAssist)
        assertNotNull(store.load().cachedEntitlements)
    }
    @Test fun plainHttpIsRefusedUnlessExplicitlyAllowedForDevelopment() {
        val (store, _) = tempStore(); store.saveLink(link().copy(apiUrl = "http://api.example"))
        val api = ApiClient(store, FakeTransport(mutableListOf(ok(replyOk))), { 1_000_000 }, 0)
        try { api.reply(ReplyRequest("i", "hi", "casual", 1)); fail() } catch (e: IllegalArgumentException) { }
    }
    @Test fun unlinkErasesLocalCredentialsEvenIfTheServerIsUnreachable() {
        val (api, t, store) = client(offline())
        api.unlink()
        assertNull(store.link()); assertTrue(t.calls.single().url.endsWith("/keyboard/unlink"))
    }
    @Test fun parsesTheServersTimestamps() { assertEquals(1893456000000L, ApiClient.parseIsoMillis("2030-01-01T00:00:00.000Z")) }
}
