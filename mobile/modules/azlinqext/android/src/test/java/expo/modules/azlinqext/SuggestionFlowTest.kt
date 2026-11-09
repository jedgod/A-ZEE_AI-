package expo.modules.azlinqext

import expo.modules.azlinqext.ai.ApiClient
import expo.modules.azlinqext.ai.Entitlements
import expo.modules.azlinqext.ai.SuggestionFlow
import expo.modules.azlinqext.ai.SuggestionUi
import org.junit.Assert.*
import org.junit.Test
import java.io.File

private class RecordingUi : SuggestionUi {
    var status: String? = null; var isError = false; var busy = false; var replies: List<String> = emptyList(); var plan: Entitlements? = null
    override fun status(message: String?, isError: Boolean) { status = message; this.isError = isError }
    override fun busy(busy: Boolean) { this.busy = busy }
    override fun replies(items: List<String>) { replies = items }
    override fun entitlements(entitlements: Entitlements?) { plan = entitlements }
}

class SuggestionFlowTest {
    private val replyOk = """{"data":{"requestId":"r","tier":"plus","replies":["Yes, Friday works.","Friday is fine."],"insertRequiresUserAction":true}}"""
    private val entOk = """{"data":$ENTITLEMENTS_JSON}"""
    private val queued = mutableListOf<() -> Unit>()

    /** Background work is held until the test releases it, so "the user moved on" can be simulated. */
    private fun flow(vararg script: () -> expo.modules.azlinqext.ai.HttpResult, ui: RecordingUi = RecordingUi(), manual: Boolean = false): Pair<SuggestionFlow, RecordingUi> {
        val (store, _) = tempStore(); store.saveLink(link()); store.saveInstallId("d".repeat(32))
        val api = ApiClient(store, FakeTransport(script.toMutableList()), { 1_000_000 }, 0)
        val run: (() -> Unit) -> Unit = { work -> if (manual) queued += work else work() }
        return SuggestionFlow(api, background = run, onMain = { it() }, newId = { "id-1" }, ui = ui) to ui
    }

    @Test fun nothingIsInsertedUntilTheUserTapsAReply() {
        val (flow, ui) = flow(ok(replyOk), ok(entOk))
        val editor = FakeEditor("can you do friday?")
        flow.suggest(editor, null, true, "casual", 2)
        assertEquals(listOf("Yes, Friday works.", "Friday is fine."), ui.replies)
        assertEquals(0, editor.writes); assertEquals("can you do friday?", editor.text)         // shown, not inserted
        flow.insert(1, editor)
        assertEquals("Friday is fine.", editor.text)
        assertTrue(ui.replies.isEmpty())
    }
    @Test fun aReplyForAnotherFieldIsDroppedNotInserted() {
        val (flow, ui) = flow(ok(replyOk), ok(entOk), manual = true)
        val editor = FakeEditor("can you do friday?")
        flow.suggest(editor, null, true, "casual", 1)
        flow.reset()                                                                           // user switched field or app
        queued.toList().also { queued.clear() }.forEach { it() }
        assertTrue(ui.replies.isEmpty()); assertEquals(0, editor.writes)
        flow.insert(0, editor); assertEquals(0, editor.writes)
    }
    @Test fun noInsertIfTheTextChangedAfterSuggesting() {
        val (flow, ui) = flow(ok(replyOk), ok(entOk))
        val editor = FakeEditor("can you do friday?")
        flow.suggest(editor, null, true, "casual", 1)
        editor.commit(" soon")                                                                 // the user kept typing
        val before = editor.text; editor.writes = 0
        flow.insert(0, editor)
        assertEquals(before, editor.text); assertEquals(0, editor.writes); assertTrue(ui.isError)
    }
    @Test fun privateFieldsNeverReachTheServer() {
        val (flow, ui) = flow()
        flow.suggest(FakeEditor("hunter2"), null, false, "casual", 1)
        assertFalse(ui.busy); assertNotNull(ui.status)                                          // FakeTransport has an empty script: any network call would throw
    }
    @Test fun withoutConsentNothingIsSent() {
        val noConsent = ENTITLEMENTS_JSON.replace("\"replyAssist\":true", "\"replyAssist\":false")
        val (flow, ui) = flow(ok("""{"data":$noConsent}"""))
        flow.refreshEntitlements()
        flow.suggest(FakeEditor("can you do friday?"), null, true, "casual", 1)                  // would throw if it called the server
        assertTrue(ui.isError); assertTrue(ui.status!!.contains("AI replies"))
    }
    @Test fun anEmptyOrOversizedMessageIsNotSent() {
        val (flow, ui) = flow()
        flow.suggest(FakeEditor("   "), null, true, "casual", 1)
        assertNotNull(ui.status); assertFalse(ui.isError)
        flow.suggest(FakeEditor("x".repeat(4001)), null, true, "casual", 1)
        assertTrue(ui.isError)
    }
    @Test fun optionsAreClampedToThePlanBeforeAnythingIsSent() {
        val (store, _) = tempStore(); store.saveLink(link()); store.saveInstallId("d".repeat(32))
        val transport = FakeTransport(mutableListOf(ok(entOk), ok(replyOk), ok(entOk)))
        val flow = SuggestionFlow(ApiClient(store, transport, { 1_000_000 }, 0), { it() }, { it() }, { "id-1" }, RecordingUi())
        flow.refreshEntitlements()
        flow.suggest(FakeEditor("hi there"), null, true, "custom", 5)                            // Plus: no custom tone, at most 3 replies
        val sent = transport.calls.first { it.url.endsWith("/replies") }.body!!
        assertTrue(sent, sent.contains("\"variants\":3")); assertTrue(sent, sent.contains("\"tone\":\"casual\""))
    }
    @Test fun failuresAreShownAndTheNotLinkedStateIsReported() {
        val (flow, ui) = flow(status(401), status(401, """{"error":"INVALID_REFRESH"}"""))
        flow.suggest(FakeEditor("can you do friday?"), null, true, "casual", 1)
        assertTrue(ui.isError); assertNull(ui.plan); assertFalse(ui.busy)
    }
    @Test fun aSelectionIsReplacedAndTheTextAroundItIsLeftAlone() {
        val (flow, _) = flow(ok(replyOk), ok(entOk))
        val editor = FakeEditor("before THE MESSAGE after", 7, 18)
        flow.suggest(editor, null, true, "casual", 1)
        flow.insert(0, editor)
        assertEquals("before Yes, Friday works. after", editor.text)
    }
    @Test fun theClipboardIsUsedOnlyWhenAskedForAndIsTypedAtTheCursor() {
        val (flow, _) = flow(ok(replyOk), ok(entOk))
        val editor = FakeEditor("Re: ")
        flow.suggest(editor, "Can you send the report?", true, "casual", 1)
        assertEquals("Re: ", editor.text)
        flow.insert(0, editor)
        assertEquals("Re: Yes, Friday works.", editor.text)
    }
}

/** The AI code has no way to send anything. These checks read the source files so a future change can't quietly add one. */
class NoAutoSendTest {
    private val root = File("src/main/java/expo/modules/azlinqext")
    private val forbidden = listOf("performEditorAction", "sendKeyEvent", "KEYCODE_ENTER", "ACTION_SEND", "SmsManager", "sendTextMessage", "AccessibilityService", "NotificationListenerService", "performAction", "dispatchGesture")

    @Test fun theAiPackageContainsNoSendMechanism() {
        val files = File(root, "ai").listFiles { f -> f.extension == "kt" }!!
        assertTrue(files.isNotEmpty())
        for (f in files) for (word in forbidden) assertFalse("${f.name} must not use $word", f.readText().contains(word))
    }
    @Test fun onlyTheEnterKeyHandlerCanPressEnterOrRunAnEditorAction() {
        val src = File(root, "ime/AzKeyboardService.kt").readText()
        val start = src.indexOf("private fun handleEnter()")
        val end = src.indexOf("private fun enterLabel()")
        assertTrue(start > 0 && end > start)
        val outside = src.removeRange(start, end)
        for (word in listOf("performEditorAction", "sendKeyEvent", "KEYCODE_ENTER")) assertFalse("$word outside handleEnter", outside.contains(word))
        // and handleEnter is reached only from the Enter key
        assertEquals(1, Regex("handleEnter\\(\\)").findAll(outside).count())
        assertTrue(outside.contains("Output.Enter -> handleEnter()"))
    }
    @Test fun noOtherPartOfTheModuleDeclaresAnAccessibilityOrNotificationService() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertFalse(manifest.contains("AccessibilityService")); assertFalse(manifest.contains("NotificationListenerService")); assertFalse(manifest.contains("SEND_SMS"))
        assertEquals(1, Regex("<service").findAll(manifest).count())
    }
}

/** "Suggest as I type": opt-in, paused, quiet on failure, and cleared the moment the user types again. */
class TypingSuggestionTest {
    private val typingOn = ENTITLEMENTS_JSON.replace("\"replyAssist\":true,\"context\":false", "\"replyAssist\":true,\"context\":false,\"typing\":true")
    private val typingOff = ENTITLEMENTS_JSON
    private val replyOk = """{"data":{"requestId":"r","tier":"plus","replies":["Are we still on for lunch tomorrow? I can do noon or one."],"insertRequiresUserAction":true}}"""
    private val draft = "hey are we still on for lunch tomorrow, i can do noon or one"

    private fun setup(entitlements: String, vararg script: () -> expo.modules.azlinqext.ai.HttpResult): Triple<SuggestionFlow, RecordingUi, FakeTransport> {
        val (store, _) = tempStore(); store.saveLink(link()); store.saveInstallId("d".repeat(32))
        val transport = FakeTransport((listOf(ok("""{"data":$entitlements}""")) + script).toMutableList())
        val ui = RecordingUi()
        val flow = SuggestionFlow(ApiClient(store, transport, { 1_000_000 }, 0), { it() }, { it() }, { "id-typing" }, ui)
        flow.refreshEntitlements()
        return Triple(flow, ui, transport)
    }

    @Test fun offUnlessTheUserTurnedItOn() {
        val (flow, ui, t) = setup(typingOff)
        flow.suggestWhileTyping(FakeEditor(draft), true, "casual")
        assertEquals(1, t.calls.size)                                  // only the plan lookup; nothing about the text was sent
        assertTrue(ui.replies.isEmpty())
    }
    @Test fun sendsOneTypingRequestAndShowsTheSuggestion() {
        val (flow, ui, t) = setup(typingOn, ok(replyOk), ok("""{"data":$typingOn}"""))
        flow.suggestWhileTyping(FakeEditor(draft), true, "casual")
        val body = t.calls[1].body!!
        assertTrue(body, body.contains("\"trigger\":\"typing\"")); assertTrue(body, body.contains("\"variants\":1"))
        assertEquals(1, ui.replies.size)
    }
    @Test fun neverInPrivateFieldsOrWithASelectionOrForShortOrLongText() {
        val (flow, ui, t) = setup(typingOn)
        flow.suggestWhileTyping(FakeEditor(draft), false, "casual")                        // private field
        flow.suggestWhileTyping(FakeEditor(draft, 0, 5), true, "casual")                   // a selection
        flow.suggestWhileTyping(FakeEditor("hi there"), true, "casual")                    // under 15 characters
        flow.suggestWhileTyping(FakeEditor("x".repeat(1001)), true, "casual")              // long drafts are tap-only
        assertEquals(1, t.calls.size); assertTrue(ui.replies.isEmpty())
    }
    @Test fun theSameTextIsNotSuggestedTwice() {
        val (flow, _, t) = setup(typingOn, ok(replyOk), ok("""{"data":$typingOn}"""))
        val e = FakeEditor(draft)
        flow.suggestWhileTyping(e, true, "casual"); flow.suggestWhileTyping(e, true, "casual")
        assertEquals(3, t.calls.size)
    }
    @Test fun typingAgainClearsTheSuggestionAndNothingStaleIsInserted() {
        val (flow, ui, _) = setup(typingOn, ok(replyOk), ok("""{"data":$typingOn}"""))
        val e = FakeEditor(draft)
        flow.suggestWhileTyping(e, true, "casual")
        assertEquals(1, ui.replies.size)
        flow.onUserTyped()
        assertTrue(ui.replies.isEmpty())
        flow.insert(0, e); assertEquals(0, e.writes); assertEquals(draft, e.text)
    }
    @Test fun tappingAnUntouchedTypingSuggestionReplacesTheDraft() {
        val (flow, _, _) = setup(typingOn, ok(replyOk), ok("""{"data":$typingOn}"""))
        val e = FakeEditor(draft)
        flow.suggestWhileTyping(e, true, "casual"); flow.insert(0, e)
        assertEquals("Are we still on for lunch tomorrow? I can do noon or one.", e.text)
    }
    @Test fun aTapSuggestionIsNotClearedByTypingButATypingOneIs() {
        val (flow, ui, _) = setup(typingOn, ok("""{"data":{"requestId":"r","tier":"plus","replies":["Sure."],"insertRequiresUserAction":true}}"""), ok("""{"data":$typingOn}"""))
        flow.suggest(FakeEditor("can you come?"), null, true, "casual", 1)
        flow.onUserTyped()
        assertEquals(listOf("Sure."), ui.replies)
    }
    @Test fun pacedOrCappedAnswersAreSilent() {
        val (flow, ui, _) = setup(typingOn, status(429, """{"error":"TOO_SOON"}"""))
        flow.suggestWhileTyping(FakeEditor(draft), true, "casual")
        assertTrue(ui.replies.isEmpty()); assertFalse(ui.isError); assertNull(ui.status)
        val (flow2, ui2, _) = setup(typingOn, status(429, """{"error":"TYPING_LIMIT_REACHED"}"""))
        flow2.suggestWhileTyping(FakeEditor(draft), true, "casual")
        assertFalse(ui2.isError); assertNull(ui2.status)
    }
    @Test fun withdrawnConsentStopsFurtherTypingRequests() {
        val (flow, _, t) = setup(typingOn, status(403, """{"error":"CONSENT_REQUIRED"}"""))
        flow.suggestWhileTyping(FakeEditor(draft), true, "casual")
        flow.onUserTyped()
        flow.suggestWhileTyping(FakeEditor("$draft and maybe two"), true, "casual")       // would need another scripted response if it called the server
        assertEquals(2, t.calls.size)
    }
}

/** The texting-assistant modes: which text each may use, plan gating, one result for single-result modes, and no stale insertion. */
class ModesTest {
    private val allModes = ENTITLEMENTS_JSON.replace("\"personalized\":true}", "\"personalized\":true,\"modes\":[\"reply\",\"rewrite\",\"grammar\",\"tone\",\"translate\",\"summarize\"],\"maxInputChars\":2000}")
    private val freeModes = ENTITLEMENTS_JSON.replace("\"personalized\":true}", "\"personalized\":false,\"modes\":[\"reply\",\"rewrite\",\"grammar\",\"tone\"],\"maxInputChars\":600}")
    private fun result(text: String) = """{"data":{"requestId":"r","mode":"x","tier":"plus","replies":["$text"],"insertRequiresUserAction":true}}"""

    private fun setup(entitlements: String, vararg script: () -> expo.modules.azlinqext.ai.HttpResult): Triple<SuggestionFlow, RecordingUi, FakeTransport> {
        val (store, _) = tempStore(); store.saveLink(link()); store.saveInstallId("d".repeat(32))
        val transport = FakeTransport((listOf(ok("""{"data":$entitlements}""")) + script).toMutableList())
        val ui = RecordingUi()
        val flow = SuggestionFlow(ApiClient(store, transport, { 1_000_000 }, 0), { it() }, { it() }, { "id-mode" }, ui)
        flow.refreshEntitlements()
        return Triple(flow, ui, transport)
    }

    @Test fun sendsTheModeAndTheLanguageToTheServer() {
        val (flow, _, t) = setup(allModes, ok(result("Hola")), ok("""{"data":$allModes}"""))
        flow.suggest(FakeEditor("see you tomorrow", 4, 16), null, true, "casual", 3, "translate", "Spanish")
        val body = t.calls[1].body!!
        assertTrue(body, body.contains("\"mode\":\"translate\"")); assertTrue(body, body.contains("\"language\":\"Spanish\"")); assertTrue(body, body.contains("\"variants\":1"))
    }
    @Test fun aReplyDoesNotCarryALanguage() {
        val (flow, _, t) = setup(allModes, ok(result("Sure")), ok("""{"data":$allModes}"""))
        flow.suggest(FakeEditor("can you come?"), null, true, "casual", 1, "reply", "Spanish")
        assertFalse(t.calls[1].body!!, t.calls[1].body!!.contains("language"))
    }
    @Test fun translateNeedsALanguageAndSendsNothingWithout() {
        val (flow, ui, t) = setup(allModes)
        flow.suggest(FakeEditor("see you tomorrow"), null, true, "casual", 1, "translate", null)
        assertEquals(1, t.calls.size); assertEquals("Choose a language first", ui.status)
    }
    @Test fun editingModesUseTheSelectionOrTypedTextButNeverTheClipboard() {
        val (flow, _, t) = setup(allModes, ok(result("Fixed.")), ok("""{"data":$allModes}"""))
        flow.suggest(FakeEditor("i dont no"), "SECRET COPIED TEXT", true, "casual", 1, "grammar")
        val body = t.calls[1].body!!
        assertTrue(body, body.contains("i dont no")); assertFalse(body, body.contains("SECRET COPIED TEXT"))
    }
    @Test fun summarizeUsesOnlyASelectionOrCopiedTextNeverWhatIsMerelyTyped() {
        val (flow, ui, t) = setup(allModes)
        flow.suggest(FakeEditor("some long text that is only typed"), null, true, "casual", 1, "summarize")
        assertEquals(1, t.calls.size)                                              // nothing was sent
        assertEquals("Select or copy the text you want summarised", ui.status)
        val (flow2, _, t2) = setup(allModes, ok(result("Short.")), ok("""{"data":$allModes}"""))
        flow2.suggest(FakeEditor("typed text"), "copied article text", true, "casual", 1, "summarize")
        assertTrue(t2.calls[1].body!!.contains("copied article text")); assertFalse(t2.calls[1].body!!.contains("typed text"))
    }
    @Test fun aModeOutsideThePlanIsRefusedWithoutAnyNetworkCall() {
        val (flow, ui, t) = setup(freeModes)
        flow.suggest(FakeEditor("hola amigo"), null, true, "casual", 1, "translate", "English")
        flow.suggest(FakeEditor("some text"), "copied", true, "casual", 1, "summarize")
        assertEquals(1, t.calls.size); assertTrue(ui.isError)
    }
    @Test fun textLongerThanThePlanAllowsIsRefusedLocally() {
        val (flow, ui, t) = setup(freeModes)
        flow.suggest(FakeEditor("x".repeat(601)), null, true, "casual", 1, "grammar")
        assertEquals(1, t.calls.size); assertTrue(ui.status!!, ui.status!!.contains("600")); assertTrue(ui.isError)
    }
    @Test fun singleResultModesAskForOneEvenIfSeveralWereChosen() {
        val (flow, _, t) = setup(allModes, ok(result("Fixed.")), ok("""{"data":$allModes}"""))
        flow.suggest(FakeEditor("fix thsi"), null, true, "casual", 3, "grammar")
        assertTrue(t.calls[1].body!!, t.calls[1].body!!.contains("\"variants\":1"))
        val (flow2, _, t2) = setup(allModes, ok(result("A")), ok("""{"data":$allModes}"""))
        flow2.suggest(FakeEditor("make this clearer please"), null, true, "casual", 3, "rewrite")
        assertTrue(t2.calls[1].body!!, t2.calls[1].body!!.contains("\"variants\":3"))
    }
    @Test fun aRewriteReplacesTheSelectionOnlyWhileItIsUnchangedAndNeverSends() {
        val (flow, _, _) = setup(allModes, ok(result("Could you please send the file?")), ok("""{"data":$allModes}"""))
        val e = FakeEditor("hey send me that file", 0, 21)
        flow.suggest(e, null, true, "casual", 1, "rewrite")
        flow.insert(0, e)
        assertEquals("Could you please send the file?", e.text)
        val (flow2, _, _) = setup(allModes, ok(result("Could you please send the file?")), ok("""{"data":$allModes}"""))
        val e2 = FakeEditor("hey send me that file", 0, 21)
        flow2.suggest(e2, null, true, "casual", 1, "rewrite")
        e2.selStart = 4                                                            // the user changed the selection
        flow2.insert(0, e2)
        assertEquals(0, e2.writes); assertEquals("hey send me that file", e2.text)
    }
    @Test fun anOverLongOrOutOfPlanAnswerFromTheServerIsShownAsAnErrorNotInserted() {
        val (flow, ui, _) = setup(allModes, status(413, """{"error":"INPUT_TOO_LONG","limit":2000}"""))
        val e = FakeEditor("some text to fix")
        flow.suggest(e, null, true, "casual", 1, "grammar")
        assertTrue(ui.isError); assertTrue(ui.replies.isEmpty()); assertEquals(0, e.writes)
    }
}
