package expo.modules.azlinqext.ime

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.content.res.ColorStateList
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.azlinqext.ai.Entitlements
import expo.modules.azlinqext.ai.SuggestionUi

/** The keyboard's screen: the AI suggestion bar on top, the typing keys below. All views are built in code. */
@SuppressLint("ViewConstructor")
class KeyboardView(context: Context, private val listener: Listener) : LinearLayout(context), SuggestionUi {
    interface Listener {
        fun onKey(key: Key)
        fun onSuggest()
        fun onClipboard()
        fun onTone()
        fun onVariants()
        fun onOpenApp()
        fun onReply(index: Int)
        fun onToggleBar()
    }

    private class Palette(val bg: Int, val key: Int, val keyAlt: Int, val text: Int, val muted: Int, val accent: Int, val accentText: Int, val error: Int, val card: Int)

    private val dark = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    private val p = if (dark) Palette(0xFF14181A.toInt(), 0xFF2A3033.toInt(), 0xFF1E2427.toInt(), 0xFFE9EEF0.toInt(), 0xFF9AA6AB.toInt(), 0xFF34D399.toInt(), 0xFF06281D.toInt(), 0xFFF87171.toInt(), 0xFF1E2427.toInt())
    else Palette(0xFFECEFF1.toInt(), 0xFFFFFFFF.toInt(), 0xFFCFD8DC.toInt(), 0xFF17201C.toInt(), 0xFF5F6B70.toInt(), 0xFF047857.toInt(), 0xFFFFFFFF.toInt(), 0xFFB91C1C.toInt(), 0xFFFFFFFF.toInt())

    private val density = resources.displayMetrics.density
    private fun dp(v: Int) = (v * density).toInt()
    private val compact = resources.displayMetrics.heightPixels / density < 480 // landscape phones: shorter keys
    private val handler = Handler(Looper.getMainLooper())

    private val tierText = text(13f, p.muted, bold = true)
    private val connect = chip("Open A-Zee", filled = false)
    private val hideButton = chip("Hide AI", filled = false).apply { minimumHeight = dp(32); contentDescription = "Hide the AI suggestion bar" }
    private val actionsRow = LinearLayout(context).apply { orientation = HORIZONTAL; setPadding(0, dp(2), 0, dp(2)) }
    private val status = text(13f, p.muted).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE; maxLines = 3 }
    private val suggest = chip("Suggest", filled = true)
    private val clipboard = chip("Clipboard", filled = false)
    private val toneButton = chip("Professional", filled = false)
    private val variantButton = chip("1 reply", filled = false)
    private val replyRow = LinearLayout(context).apply { orientation = HORIZONTAL }
    private val replyScroll = HorizontalScrollView(context).apply { isHorizontalScrollBarEnabled = false; visibility = GONE; addView(replyRow) }
    private val keys = LinearLayout(context).apply { orientation = VERTICAL }
    private var aiEnabled = true
    private var barHidden = false

    init {
        orientation = VERTICAL
        setBackgroundColor(p.bg)
        setPadding(dp(4), dp(4), dp(4), dp(4))
        val header = LinearLayout(context).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8), 0, dp(4), 0) }
        header.addView(tierText, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
        header.addView(connect)
        header.addView(hideButton, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { setMargins(dp(6), 0, 0, 0) })
        addView(header)
        addView(status, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply { setMargins(dp(8), dp(2), dp(8), dp(2)) })
        listOf(suggest, clipboard, toneButton, variantButton).forEach { actionsRow.addView(it, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(dp(2), 0, dp(2), 0) }) }
        addView(actionsRow)
        addView(replyScroll, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        addView(keys)

        suggest.setOnClickListener { listener.onSuggest() }
        clipboard.setOnClickListener { listener.onClipboard() }
        toneButton.setOnClickListener { listener.onTone() }
        variantButton.setOnClickListener { listener.onVariants() }
        connect.setOnClickListener { listener.onOpenApp() }
        hideButton.setOnClickListener { listener.onToggleBar() }
        suggest.contentDescription = "Suggest a reply to the selected or typed message"
        clipboard.contentDescription = "Suggest a reply to the copied message"
        status("Select or type a message, then tap Suggest")
    }

    // ---- typing keys ----

    fun renderKeys(state: KeyboardState, enterLabel: String) {
        keys.removeAllViews()
        val rowHeight = dp(if (compact) 40 else 50)
        KeyboardLogic.rows(state, enterLabel).forEach { row ->
            val line = LinearLayout(context).apply { orientation = HORIZONTAL }
            row.forEach { spec ->
                val special = spec.key !is Key.Char && spec.key !is Key.Space
                val view = text(if (spec.label.length > 2) 15f else 20f, p.text, bold = special).apply {
                    gravity = Gravity.CENTER
                    text = spec.label
                    contentDescription = spec.description
                    minimumHeight = rowHeight
                    background = ripple(if (special) p.keyAlt else p.key, dp(6))
                    isClickable = true
                    isFocusable = true
                }
                if (spec.key is Key.Backspace) attachRepeat(view, spec.key) else view.setOnClickListener { it.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP); listener.onKey(spec.key) }
                line.addView(view, LayoutParams(0, rowHeight, spec.weight).apply { setMargins(dp(2), dp(3), dp(2), dp(3)) })
            }
            keys.addView(line)
        }
    }

    /** Holding backspace keeps deleting. */
    @SuppressLint("ClickableViewAccessibility")
    private fun attachRepeat(view: View, key: Key) {
        val repeat = object : Runnable { override fun run() { listener.onKey(key); handler.postDelayed(this, 55) } }
        view.setOnTouchListener { v, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { v.isPressed = true; v.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP); listener.onKey(key); handler.postDelayed(repeat, 400) }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { v.isPressed = false; handler.removeCallbacks(repeat) }
            }
            true
        }
        view.setOnClickListener { } // lets accessibility services activate it
    }

    // ---- AI bar ----

    fun setAiEnabled(enabled: Boolean, reason: String? = null) {
        aiEnabled = enabled
        listOf(suggest, clipboard, toneButton, variantButton).forEach { it.isEnabled = enabled; it.alpha = if (enabled) 1f else 0.4f }
        if (!enabled) { replies(emptyList()); status(reason ?: "AI replies are off in this field", false) }
        else status("Select or type a message, then tap Suggest")
    }

    /** Collapses the AI bar to a single "Show AI" button, leaving the typing keys. */
    fun setBarHidden(hidden: Boolean) {
        barHidden = hidden
        hideButton.text = if (hidden) "Show AI" else "Hide AI"
        hideButton.contentDescription = if (hidden) "Show the AI suggestion bar" else "Hide the AI suggestion bar"
        val shown = if (hidden) GONE else VISIBLE
        tierText.visibility = shown; actionsRow.visibility = shown
        if (hidden) { connect.visibility = GONE; status.visibility = GONE; replyScroll.visibility = GONE; replyRow.removeAllViews() } else if (status.text.isNotEmpty()) status.visibility = VISIBLE
    }

    fun setOptions(tone: String, variants: Int) {
        toneButton.text = tone.replaceFirstChar { it.uppercase() }
        toneButton.contentDescription = "Tone: $tone. Tap to change"
        variantButton.text = if (variants == 1) "1 reply" else "$variants replies"
        variantButton.contentDescription = "Number of replies: $variants. Tap to change"
    }

    override fun status(message: String?, isError: Boolean) {
        status.text = message ?: ""
        status.setTextColor(if (isError) p.error else p.muted)
        status.visibility = if (message.isNullOrEmpty()) GONE else VISIBLE
    }

    override fun busy(busy: Boolean) {
        suggest.isEnabled = !busy && aiEnabled
        clipboard.isEnabled = !busy && aiEnabled
        suggest.text = if (busy) "Writing…" else "Suggest"
    }

    override fun replies(items: List<String>) {
        replyRow.removeAllViews()
        replyScroll.visibility = if (items.isEmpty()) GONE else VISIBLE
        items.forEachIndexed { i, reply ->
            val card = text(15f, p.text).apply {
                text = reply
                maxLines = 5
                setPadding(dp(12), dp(10), dp(12), dp(10))
                background = ripple(p.card, dp(10), stroke = p.accent)
                isClickable = true
                isFocusable = true
                contentDescription = "Reply ${i + 1} of ${items.size}: $reply. Double tap to put it in the text box"
                setOnClickListener { listener.onReply(i) }
            }
            replyRow.addView(card, LayoutParams(dp(if (items.size == 1) 320 else 260), LayoutParams.WRAP_CONTENT).apply { setMargins(dp(4), dp(2), dp(4), dp(4)) })
        }
        replyScroll.scrollTo(0, 0)
    }

    override fun entitlements(entitlements: Entitlements?) {
        if (entitlements == null) {
            tierText.text = "Not connected"
            connect.visibility = VISIBLE
            return
        }
        val left = entitlements.usage.remaining?.let { "$it left this month" } ?: "unlimited"
        tierText.text = "${entitlements.plan} · $left"
        connect.visibility = if (entitlements.consent.replyAssist) GONE else VISIBLE
        if (!entitlements.consent.replyAssist) status("Turn on AI replies in the A-Zee app to use suggestions", true)
    }

    // ---- view helpers ----

    private fun text(size: Float, color: Int, bold: Boolean = false) = TextView(context).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun chip(label: String, filled: Boolean) = text(13f, if (filled) p.accentText else p.text, bold = true).apply {
        text = label
        gravity = Gravity.CENTER
        minimumHeight = dp(40)
        setPadding(dp(6), 0, dp(6), 0)
        maxLines = 1
        background = ripple(if (filled) p.accent else p.keyAlt, dp(20))
        isClickable = true
        isFocusable = true
    }

    private fun ripple(fill: Int, radius: Int, stroke: Int? = null): RippleDrawable {
        val shape = GradientDrawable().apply { setColor(fill); cornerRadius = radius.toFloat(); if (stroke != null) setStroke(dp(1), stroke) }
        return RippleDrawable(ColorStateList.valueOf(Color.argb(60, 128, 128, 128)), shape, null)
    }
}
