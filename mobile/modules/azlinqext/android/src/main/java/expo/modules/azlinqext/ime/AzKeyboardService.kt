package expo.modules.azlinqext.ime

import android.content.ClipboardManager
import android.content.Intent
import android.inputmethodservice.InputMethodService
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import expo.modules.azlinqext.ai.ApiClient
import expo.modules.azlinqext.ai.EditorPort
import expo.modules.azlinqext.ai.Entitlements
import expo.modules.azlinqext.ai.FieldPolicy
import expo.modules.azlinqext.ai.SuggestionFlow
import expo.modules.azlinqext.ai.SuggestionUi
import expo.modules.azlinqext.store.KeyboardStore
import java.util.UUID
import java.util.concurrent.Executors

/**
 * The AZLinqext keyboard: a full typing keyboard with an AI reply bar. The bar only reads text when the
 * user taps Suggest, never in password or other private fields, and only drafts: the user taps a reply to
 * put it in the box and then sends it themselves.
 */
class AzKeyboardService : InputMethodService(), KeyboardView.Listener, SuggestionUi {
    private companion object {
        const val TYPING_PAUSE_MS = 1500L
        val ALL_MODES = listOf("reply", "rewrite", "grammar", "tone", "translate", "summarize")
        val DEFAULT_MODES = listOf("reply", "rewrite", "grammar", "tone")
    }

    private val main = Handler(Looper.getMainLooper())
    private val pool = Executors.newFixedThreadPool(2)
    private lateinit var api: ApiClient
    private lateinit var flow: SuggestionFlow
    private var view: KeyboardView? = null

    private var state = KeyboardState()
    private var fieldInputType = 0
    private var fieldAllowed = false
    private var autoCapitalize = false
    private var tone = "professional"
    private var variants = 1
    private var mode = "reply"
    private var language: String? = null
    private var features: Entitlements? = null
    private lateinit var prefs: KeyboardPrefs
    private val typingRunnable = Runnable { flow.suggestWhileTyping(editor, fieldAllowed && !prefs.barHidden, tone) }

    /** The text field, seen only through the four operations the AI side is allowed to use. */
    private val editor = object : EditorPort {
        override fun selectedText() = currentInputConnection?.getSelectedText(0)?.toString()
        override fun textBeforeCursor(maxChars: Int) = currentInputConnection?.getTextBeforeCursor(maxChars, 0)?.toString()
        override fun deleteSurrounding(before: Int, after: Int) = currentInputConnection?.deleteSurroundingText(before, after) ?: false
        override fun commit(text: String) = currentInputConnection?.commitText(text, 1) ?: false
    }

    override fun onCreate() {
        super.onCreate()
        prefs = KeyboardPrefs(this)
        api = ApiClient(KeyboardStore.forContext(this))
        flow = SuggestionFlow(api, background = { pool.execute(it) }, onMain = { main.post(it) }, newId = { UUID.randomUUID().toString() }, ui = this)
    }

    override fun onCreateInputView(): View = KeyboardView(this, this).also { v ->
        view = v
        v.renderKeys(state, enterLabel())
        v.setOptions(mode, tone, variants, language)
        v.setAiEnabled(fieldAllowed)
        v.setBarHidden(prefs.barHidden)
        features?.let { v.entitlements(it) }
    }

    override fun onEvaluateFullscreenMode() = false

    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        main.removeCallbacks(typingRunnable)
        flow.reset()
        fieldInputType = info?.inputType ?: 0
        val cls = fieldInputType and InputType.TYPE_MASK_CLASS
        fieldAllowed = FieldPolicy.aiAllowed(fieldInputType, info?.imeOptions ?: 0)
        autoCapitalize = cls == InputType.TYPE_CLASS_TEXT && fieldInputType and InputType.TYPE_MASK_FLAGS and
            (InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_CAP_WORDS or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS) != 0
        state = KeyboardState(layer = if (cls == InputType.TYPE_CLASS_NUMBER || cls == InputType.TYPE_CLASS_PHONE) Layer.NUMBERS else Layer.LETTERS)
        updateShiftFromCursor()
        view?.apply {
            renderKeys(state, enterLabel())
            setAiEnabled(fieldAllowed, if (FieldPolicy.isSecret(fieldInputType)) "AI replies are off in password fields" else null)
        }
        view?.setBarHidden(prefs.barHidden)
        if (fieldAllowed && !prefs.barHidden) flow.refreshEntitlements()
    }

    /** Anything shown is dropped when the field or app changes, so a reply can never land somewhere it wasn't made for. */
    override fun onFinishInputView(finishingInput: Boolean) { main.removeCallbacks(typingRunnable); flow.reset(); super.onFinishInputView(finishingInput) }
    override fun onFinishInput() { main.removeCallbacks(typingRunnable); flow.reset(); super.onFinishInput() }
    override fun onDestroy() { main.removeCallbacks(typingRunnable); flow.reset(); pool.shutdownNow(); super.onDestroy() }

    // ---- typing ----

    override fun onKey(key: Key) {
        val (next, output) = KeyboardLogic.press(state, key)
        val ic = currentInputConnection
        when (output) {
            is Output.Commit -> ic?.commitText(output.text, 1)
            Output.DeleteBackward -> deleteBackward()
            Output.Enter -> handleEnter()
            Output.SwitchKeyboard -> switchKeyboard()
            Output.None -> Unit
        }
        state = next
        if (output is Output.Commit || output == Output.DeleteBackward) { updateShiftFromCursor(); onTextTyped() }
        view?.renderKeys(state, enterLabel())
    }

    /** After each typed character: drop any stale typing suggestion, and ask for a new one once typing pauses (only if the user opted in). */
    private fun onTextTyped() {
        main.removeCallbacks(typingRunnable)
        flow.onUserTyped()
        if (fieldAllowed && !prefs.barHidden && features?.consent?.typing == true) main.postDelayed(typingRunnable, TYPING_PAUSE_MS)
    }

    private fun deleteBackward() {
        val ic = currentInputConnection ?: return
        if (!ic.getSelectedText(0).isNullOrEmpty()) ic.commitText("", 1) else ic.deleteSurroundingTextInCodePoints(1, 0)
    }

    /** Capitalise the next letter at the start of a sentence, when the field asks for it. */
    private fun updateShiftFromCursor() {
        if (!autoCapitalize || state.shift == Shift.LOCK) return
        val caps = currentInputConnection?.getCursorCapsMode(fieldInputType) ?: 0
        state = state.copy(shift = if (caps != 0) Shift.ONCE else Shift.OFF)
    }

    /**
     * The user pressed the Enter key. This is the only place in the keyboard that performs an editor action
     * or sends an Enter key press, and only in response to that key. Reply suggestions never come here.
     */
    private fun handleEnter() {
        val info = currentInputEditorInfo
        val ic = currentInputConnection ?: return
        val action = (info?.imeOptions ?: 0) and EditorInfo.IME_MASK_ACTION
        val noEnterAction = (info?.imeOptions ?: 0) and EditorInfo.IME_FLAG_NO_ENTER_ACTION != 0
        if (info == null || noEnterAction || action == EditorInfo.IME_ACTION_NONE || action == EditorInfo.IME_ACTION_UNSPECIFIED) {
            ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
            ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
        } else {
            ic.performEditorAction(action)
        }
    }

    private fun enterLabel(): String = when ((currentInputEditorInfo?.imeOptions ?: 0) and EditorInfo.IME_MASK_ACTION) {
        EditorInfo.IME_ACTION_GO -> "Go"
        EditorInfo.IME_ACTION_SEARCH -> "Search"
        EditorInfo.IME_ACTION_SEND -> "Send"
        EditorInfo.IME_ACTION_NEXT -> "Next"
        EditorInfo.IME_ACTION_DONE -> "Done"
        else -> "↵"
    }

    private fun switchKeyboard() {
        val imm = getSystemService(InputMethodManager::class.java)
        if (!switchToNextInputMethod(false)) imm?.showInputMethodPicker()
    }

    // ---- AI bar ----

    override fun onSuggest() = flow.suggest(editor, null, fieldAllowed, tone, variants, mode, language)

    override fun onClipboard() {
        val clip = getSystemService(ClipboardManager::class.java)?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()
        if (clip.isNullOrBlank()) status("Nothing copied yet. Copy a message first", false)
        else flow.suggest(editor, clip, fieldAllowed, tone, variants, mode, language)
    }

    override fun onMode() {
        val allowed = ALL_MODES.filter { it in (features?.features?.modes ?: DEFAULT_MODES) }
        mode = allowed[(allowed.indexOf(mode) + 1).mod(allowed.size)]
        if (mode == "translate" && language == null) language = languageChoices().first()
        flow.reset() // a result shown for another mode must not be insertable
        view?.setOptions(mode, tone, variants, language)
        if (features != null && ALL_MODES.any { it !in features!!.features.modes }) status("Translate and Summarize need the Plus plan", false)
    }

    override fun onLanguage() {
        val languages = languageChoices()
        language = languages[(languages.indexOf(language) + 1).mod(languages.size)]
        view?.setOptions(mode, tone, variants, language)
    }

    private fun languageChoices() = features?.languages?.takeIf { it.isNotEmpty() } ?: listOf("Spanish", "French", "German", "Portuguese", "Italian", "English")

    override fun onTone() {
        val tones = features?.features?.tones ?: listOf("casual", "professional")
        tone = tones[(tones.indexOf(tone) + 1).mod(tones.size)]
        view?.setOptions(mode, tone, variants, language)
    }

    override fun onVariants() {
        val max = features?.features?.variants ?: 1
        variants = if (variants >= max) 1 else variants + 1
        view?.setOptions(mode, tone, variants, language)
        if (max == 1) status("More than one reply needs the Plus plan", false)
    }

    override fun onOpenApp() {
        packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    override fun onReply(index: Int) = flow.insert(index, editor)

    override fun onToggleBar() {
        val hide = !prefs.barHidden
        prefs.barHidden = hide
        main.removeCallbacks(typingRunnable)
        flow.reset()
        view?.setBarHidden(hide)
        if (!hide) { view?.setAiEnabled(fieldAllowed); if (fieldAllowed) flow.refreshEntitlements() }
    }

    // SuggestionUi: forwarded to the view, remembering the plan so the tone and reply-count buttons follow it.
    override fun status(message: String?, isError: Boolean) { view?.status(message, isError) }
    override fun busy(busy: Boolean) { view?.busy(busy) }
    override fun replies(items: List<String>) { view?.replies(items) }
    override fun entitlements(entitlements: Entitlements?) {
        features = entitlements
        entitlements?.let {
            if (tone !in it.features.tones) tone = it.features.tones.firstOrNull() ?: "professional"
            variants = variants.coerceIn(1, it.features.variants)
            if (mode !in it.features.modes) mode = "reply"
            if (mode == "translate" && language == null) language = languageChoices().first()
        }
        view?.setOptions(mode, tone, variants, language)
        view?.entitlements(entitlements)
    }
}
