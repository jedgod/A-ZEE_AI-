package expo.modules.azlinqext.ai

/** What the suggestion flow shows. Implemented by the keyboard's suggestion bar. */
interface SuggestionUi {
    fun status(message: String?, isError: Boolean = false)
    fun busy(busy: Boolean)
    fun replies(items: List<String>)
    fun entitlements(entitlements: Entitlements?)
}

/**
 * The suggestion bar's behaviour: read the message the user chose, ask A-Zee for replies, show them,
 * and insert one only when the user taps it. It is a draft assistant: nothing here sends, submits or
 * presses a key, and a stale answer (the user moved to another field or app) is dropped, never inserted.
 *
 * Two triggers: the user taps Suggest ([suggest]), or, only if they turned on "Suggest as I type",
 * the keyboard asks after a pause in typing ([suggestWhileTyping]). A typing-triggered suggestion is
 * cleared the moment the user types again.
 *
 * [background] runs work off the main thread; [onMain] returns to it. Both are injected so the flow
 * can be tested without Android. Message text is never logged.
 */
class SuggestionFlow(
    private val api: ApiClient,
    private val background: (() -> Unit) -> Unit,
    private val onMain: (() -> Unit) -> Unit,
    private val newId: () -> String,
    private val ui: SuggestionUi,
) {
    private var generation = 0
    private var draft: Draft? = null
    private var shown: List<String> = emptyList()
    private var known: Entitlements? = null
    private var typingShown = false
    private var typingInFlight = false
    private var lastTypingText: String? = null

    /** The field changed, the keyboard was hidden, or the user signed out: forget everything shown and ignore anything still in flight. */
    fun reset() {
        generation++
        draft = null
        shown = emptyList()
        typingShown = false
        typingInFlight = false
        lastTypingText = null
        ui.replies(emptyList())
        ui.busy(false)
    }

    fun refreshEntitlements() {
        val gen = generation
        background {
            val result = try { api.entitlements() } catch (e: ApiFailure.NotLinked) { null } catch (_: Exception) { return@background }
            onMain { known = result; ui.entitlements(result); if (result == null && gen == generation) ui.status(ApiFailure.NotLinked().message, true) }
        }
    }

    fun suggest(editor: EditorPort, clipboard: String?, fieldAllowed: Boolean, tone: String, variants: Int) {
        if (!fieldAllowed) { ui.status("AI replies are off in this kind of field", false); return }
        known?.let { if (!it.consent.replyAssist) { ui.status(ApiFailure.ConsentRequired().message, true); return } }

        val source = chooseSource(editor, clipboard) ?: run { ui.status("Select or type the message you want a reply to", false); return }
        if (source.text.length > MAX_MESSAGE_CHARS) { ui.status("That message is too long. Select up to $MAX_MESSAGE_CHARS characters", true); return }

        val features = known?.features
        val useVariants = if (features == null) variants.coerceIn(1, 5) else variants.coerceIn(1, features.variants)
        val gen = ++generation
        typingShown = false
        typingInFlight = false
        draft = source
        shown = emptyList()
        ui.replies(emptyList())
        ui.busy(true)
        ui.status("Writing a reply…", false)
        val request = ReplyRequest(newId(), source.text, clampTone(tone), useVariants)
        background {
            try {
                val result = api.reply(request)
                onMain {
                    if (gen != generation) return@onMain // the user moved on; this answer is for a different field
                    ui.busy(false)
                    if (result.replies.isEmpty()) { ui.status("No reply came back. Try again", true); return@onMain }
                    shown = result.replies
                    ui.replies(shown)
                    ui.status("Tap a reply to use it. Nothing is sent until you send it", false)
                }
                refreshEntitlements()
            } catch (e: ApiFailure) {
                onMain { if (gen == generation) { ui.busy(false); ui.status(e.message, true); if (e is ApiFailure.NotLinked) ui.entitlements(null) } }
            } catch (e: Exception) {
                onMain { if (gen == generation) { ui.busy(false); ui.status("Something went wrong. Try again", true) } }
            }
        }
    }

    /**
     * Called after a pause in typing, only when the user has turned on "Suggest as I type". Reads the
     * text before the cursor (never a selection, never a private field), asks for one improved version,
     * and shows it. Everything that goes wrong is silent: this must never nag someone who is typing.
     */
    fun suggestWhileTyping(editor: EditorPort, fieldAllowed: Boolean, tone: String) {
        val plan = known ?: return
        if (!fieldAllowed || !plan.consent.replyAssist || !plan.consent.typing || typingInFlight) return
        if (!editor.selectedText().isNullOrEmpty()) return
        val text = editor.textBeforeCursor(TYPING_MAX_CHARS + 1) ?: return
        if (text.length > TYPING_MAX_CHARS || text.trim().length < TYPING_MIN_CHARS || text == lastTypingText) return
        lastTypingText = text

        val gen = ++generation
        draft = Draft(SourceKind.BEFORE_CURSOR, text)
        typingShown = true
        typingInFlight = true
        shown = emptyList()
        ui.replies(emptyList())
        val request = ReplyRequest(newId(), text, clampTone(tone), 1, trigger = "typing")
        background {
            try {
                val result = api.reply(request)
                onMain {
                    if (gen == generation) typingInFlight = false
                    if (gen != generation || result.replies.isEmpty()) return@onMain
                    shown = result.replies
                    ui.replies(shown)
                    ui.status("Suggestion ready. Tap it to use it, or keep typing", false)
                }
                refreshEntitlements()
            } catch (e: ApiFailure) {
                onMain {
                    if (gen != generation) return@onMain
                    typingInFlight = false; typingShown = false; draft = null
                    when (e) {
                        is ApiFailure.NotLinked -> { ui.status(e.message, true); ui.entitlements(null) }
                        is ApiFailure.ConsentRequired -> { known = known?.let { it.copy(consent = it.consent.copy(typing = false)) } } // withdrawn elsewhere: stop asking
                        else -> Unit // paced, offline, over a limit: say nothing while someone is typing
                    }
                }
            } catch (_: Exception) {
                onMain { if (gen == generation) { typingInFlight = false; typingShown = false; draft = null } }
            }
        }
    }

    /** The user typed again: a suggestion made from older text is stale, so it goes away. */
    fun onUserTyped() {
        if (!typingShown) return
        generation++
        typingShown = false
        typingInFlight = false
        draft = null
        shown = emptyList()
        ui.replies(emptyList())
        ui.status(null, false)
    }

    /** The user tapped reply [index]. This is the only way a reply reaches the text field. */
    fun insert(index: Int, editor: EditorPort) {
        val source = draft ?: return
        val reply = shown.getOrNull(index) ?: return
        when (InsertPlanner.insert(editor, source, reply)) {
            InsertOutcome.INSERTED -> { clearShown(); lastTypingText = null; ui.status("Inserted. Check it, then send it yourself", false) }
            InsertOutcome.SOURCE_CHANGED -> { clearShown(); ui.status("The text changed, so nothing was inserted. Tap Suggest again", true) }
            InsertOutcome.FAILED -> ui.status("Couldn't insert that reply", true)
        }
    }

    private fun clearShown() { generation++; draft = null; shown = emptyList(); typingShown = false; typingInFlight = false; ui.replies(emptyList()) }

    private fun clampTone(tone: String): String {
        val tones = known?.features?.tones ?: return tone
        return if (tone in tones) tone else tones.firstOrNull() ?: "professional"
    }

    private fun chooseSource(editor: EditorPort, clipboard: String?): Draft? {
        clipboard?.takeIf { it.isNotBlank() }?.let { return Draft(SourceKind.CLIPBOARD, it) }
        editor.selectedText()?.takeIf { it.isNotBlank() }?.let { return Draft(SourceKind.SELECTION, it) }
        editor.textBeforeCursor(MAX_MESSAGE_CHARS + 1)?.takeIf { it.isNotBlank() }?.let { return Draft(SourceKind.BEFORE_CURSOR, it) }
        return null
    }

    companion object {
        const val MAX_MESSAGE_CHARS = 4000
        const val TYPING_MIN_CHARS = 15   // shorter than this isn't worth a suggestion
        const val TYPING_MAX_CHARS = 1000 // long drafts are suggested only on tap
    }
}
