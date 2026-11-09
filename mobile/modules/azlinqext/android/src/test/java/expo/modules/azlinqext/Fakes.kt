package expo.modules.azlinqext

import expo.modules.azlinqext.ai.EditorPort
import expo.modules.azlinqext.ai.HttpResult
import expo.modules.azlinqext.ai.HttpTransport
import expo.modules.azlinqext.store.KeyboardStore
import expo.modules.azlinqext.store.SecretBox
import java.io.File
import java.io.IOException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** AES-GCM with a fixed software key, standing in for the Android Keystore on the JVM. */
class SoftwareBox : SecretBox {
    private val key = SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")
    override fun encrypt(plain: ByteArray): ByteArray {
        val iv = ByteArray(12) { (it * 7).toByte() }
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv)) }
        return iv + c.doFinal(plain)
    }
    override fun decrypt(blob: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, blob.copyOfRange(0, 12))) }
        return c.doFinal(blob, 12, blob.size - 12)
    }
}

fun tempStore(): Pair<KeyboardStore, File> {
    val dir = File.createTempFile("azlinqext", "").apply { delete(); mkdirs(); deleteOnExit() }
    val file = File(dir, "store.bin")
    return KeyboardStore(file, SoftwareBox()) to file
}

fun link(access: String = "azk_a", accessExpiresAt: Long = Long.MAX_VALUE / 2, refresh: String = "azr_r", refreshExpiresAt: Long = Long.MAX_VALUE / 2, user: String = "u1") =
    KeyboardStore.Link("https://api.example", false, user, "Ada", access, accessExpiresAt, refresh, refreshExpiresAt)

/** A scripted server: each call takes the next response (or throws), and every call is recorded. */
class FakeTransport(private val script: MutableList<() -> HttpResult>) : HttpTransport {
    data class Call(val method: String, val url: String, val headers: Map<String, String>, val body: String?)
    val calls = mutableListOf<Call>()
    override fun execute(method: String, url: String, headers: Map<String, String>, body: String?, timeoutMs: Int): HttpResult {
        calls += Call(method, url, headers, body)
        return script.removeAt(0)()
    }
}

fun ok(json: String) = { HttpResult(200, json) }
fun status(code: Int, json: String = "{}") = { HttpResult(code, json) }
fun offline(): () -> HttpResult = { throw IOException("down") }

/** A text field in memory. It records every write so tests can prove nothing was written without a tap. */
class FakeEditor(var text: String = "", var selStart: Int = text.length, var selEnd: Int = text.length) : EditorPort {
    var writes = 0
    override fun selectedText() = if (selStart == selEnd) null else text.substring(selStart, selEnd)
    override fun textBeforeCursor(maxChars: Int) = text.substring(0, selStart).takeLast(maxChars)
    override fun deleteSurrounding(before: Int, after: Int): Boolean {
        writes++
        text = text.substring(0, selStart - before) + text.substring(selEnd + after); selStart -= before; selEnd = selStart; return true
    }
    override fun commit(text: String): Boolean {
        writes++
        this.text = this.text.substring(0, selStart) + text + this.text.substring(selEnd); selStart += text.length; selEnd = selStart; return true
    }
}

const val ENTITLEMENTS_JSON = """{"tier":"plus","plan":"Plus","features":{"context":5,"variants":3,"maxWords":90,"tones":["casual","professional","friendly"],"personalized":true},
 "usage":{"used":12,"limit":5000,"remaining":4988,"resetsAt":"2026-12-01T00:00:00.000Z"},"consent":{"version":1,"replyAssist":true,"context":false,"current":true}}"""
