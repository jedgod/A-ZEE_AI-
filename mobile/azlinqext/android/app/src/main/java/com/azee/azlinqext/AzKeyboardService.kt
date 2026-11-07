package com.azee.azlinqext

import android.inputmethodservice.InputMethodService
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.text.InputType
import java.util.UUID
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import java.util.concurrent.Executors

/** Minimal IME prototype. Replace token provider with A-Zee's short-lived authenticated session. */
class AzKeyboardService : InputMethodService() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var suggestion: TextView
    private var proposed = ""
    private var sensitive = false

    override fun onCreateInputView(): View {
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        suggestion = TextView(this).apply { text = "AZLinqext · Select text and tap Suggest"; textSize = 15f; setPadding(18,14,18,14) }
        layout.addView(suggestion)
        val actions = LinearLayout(this)
        val suggest = Button(this).apply { text = "Suggest"; setOnClickListener { generate() } }
        val insert = Button(this).apply { text = "Insert"; setOnClickListener { if (!sensitive && proposed.isNotBlank()) currentInputConnection?.commitText(proposed,1) } }
        val hide = Button(this).apply { text = "Hide"; setOnClickListener { suggestion.visibility = View.GONE } }
        actions.addView(suggest);actions.addView(insert);actions.addView(hide);layout.addView(actions)
        return layout
    }
    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info,restarting)
        val type = info?.inputType ?: 0
        val variation = type and InputType.TYPE_MASK_VARIATION
        sensitive = (type and InputType.TYPE_TEXT_VARIATION_PASSWORD != 0) ||
            variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
            variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
        proposed = ""
        if (::suggestion.isInitialized) suggestion.text = if(sensitive) "AZLinqext unavailable in sensitive fields" else "AZLinqext ready · Tap Suggest"
    }
    private fun generate() {
        if (sensitive) return
        val selected = currentInputConnection?.getSelectedText(0)?.toString()?.take(4000).orEmpty()
        if (selected.isBlank()) { suggestion.text = "Select a message to reply to first";return }
        suggestion.text = "Generating suggestion…"
        executor.execute {
            try {
                val token = SessionTokenProvider.getAccessToken(this) ?: throw IllegalStateException("Sign in to A-Zee")
                val request = JSONObject().put("requestId",UUID.randomUUID().toString())
                    .put("message",selected).put("tone","professional").put("variants",1).put("consent",true)
                val conn = (URL(BuildConfig.AZ_API_URL + "/api/linqext/replies").openConnection() as HttpURLConnection).apply {
                    requestMethod="POST";connectTimeout=5000;readTimeout=12000;doOutput=true
                    setRequestProperty("Authorization","Bearer $token")
                    setRequestProperty("X-AZ-Client","mobile")
                    setRequestProperty("Content-Type","application/json")
                }
                conn.outputStream.use { it.write(request.toString().toByteArray(Charsets.UTF_8)) }
                val code=conn.responseCode
                if(code !in 200..299) throw IllegalStateException("Request failed ($code)")
                val response=conn.inputStream.bufferedReader().use { JSONObject(it.readText()) }
                val reply=response.getJSONObject("data").getJSONArray("replies").getString(0)
                runOnUiThread { proposed=reply;suggestion.text=reply }
                conn.disconnect()
            } catch (e: Exception) { runOnUiThread { suggestion.text=e.message ?: "Unable to generate reply" } }
        }
    }
    override fun onDestroy() { executor.shutdownNow();super.onDestroy() }
}
/** Deliberately fail-closed until wired to a real A-Zee sign-in flow. */
object SessionTokenProvider {
    fun getAccessToken(context: android.content.Context): String? = null
}
