package expo.modules.azlinqext.store

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts and decrypts the store's bytes. The real one uses a non-exportable Android Keystore key. */
interface SecretBox {
    fun encrypt(plain: ByteArray): ByteArray
    fun decrypt(blob: ByteArray): ByteArray
}

class KeystoreBox(private val alias: String = "azlinqext.store.v1") : SecretBox {
    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    override fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return cipher.iv + cipher.doFinal(plain)
    }

    override fun decrypt(blob: ByteArray): ByteArray {
        require(blob.size > IV_BYTES + 16) { "blob too short" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob.copyOfRange(0, IV_BYTES)))
        return cipher.doFinal(blob, IV_BYTES, blob.size - IV_BYTES)
    }

    private companion object { const val IV_BYTES = 12 }
}

/**
 * The keyboard's credentials and cached plan, in one encrypted file. It lives in noBackupFilesDir,
 * so Android never backs it up or restores it onto another device, and it is readable only by this app.
 * A file that can't be decrypted (key lost, file damaged) is deleted and treated as "not linked".
 */
class KeyboardStore(private val file: File, private val box: SecretBox) {
    data class Link(
        val apiUrl: String,
        val allowHttp: Boolean,
        val userId: String,
        val displayName: String,
        val accessToken: String,
        val accessExpiresAtMs: Long,
        val refreshToken: String,
        val refreshExpiresAtMs: Long,
    )

    data class Snapshot(val link: Link?, val installId: String?, val cachedEntitlements: String?)

    @Synchronized
    fun load(): Snapshot {
        if (!file.exists()) return Snapshot(null, null, null)
        return try {
            val json = JSONObject(String(box.decrypt(file.readBytes()), Charsets.UTF_8))
            Snapshot(
                link = json.optJSONObject("link")?.let(::readLink),
                installId = json.optString("installId").ifEmpty { null },
                cachedEntitlements = json.optString("entitlements").ifEmpty { null },
            )
        } catch (e: Exception) {
            file.delete()
            Snapshot(null, null, null)
        }
    }

    fun link(): Link? = load().link

    @Synchronized
    fun saveLink(link: Link) {
        val current = load()
        // A different account's cache must never be shown to the new one.
        val keepCache = current.link?.userId == link.userId
        writeRaw(link, current.installId, if (keepCache) current.cachedEntitlements else null)
    }

    @Synchronized
    fun updateTokens(accessToken: String, accessExpiresAtMs: Long, refreshToken: String, refreshExpiresAtMs: Long) {
        val current = load()
        val link = current.link ?: return
        writeRaw(link.copy(accessToken = accessToken, accessExpiresAtMs = accessExpiresAtMs, refreshToken = refreshToken, refreshExpiresAtMs = refreshExpiresAtMs), current.installId, current.cachedEntitlements)
    }

    @Synchronized
    fun saveEntitlements(json: String) {
        val current = load()
        val link = current.link ?: return
        writeRaw(link, current.installId, json)
    }

    @Synchronized
    fun saveInstallId(id: String) {
        val current = load()
        writeRaw(current.link, id, current.cachedEntitlements)
    }

    /** Signs the keyboard out: credentials and cached plan are erased; the random install id stays. */
    @Synchronized
    fun clearLink() {
        val current = load()
        if (current.installId == null) file.delete() else writeRaw(null, current.installId, null)
    }

    private fun writeRaw(link: Link?, installId: String?, entitlements: String?) {
        val json = JSONObject()
        if (link != null) json.put("link", JSONObject().apply {
            put("apiUrl", link.apiUrl); put("allowHttp", link.allowHttp); put("userId", link.userId); put("displayName", link.displayName)
            put("accessToken", link.accessToken); put("accessExpiresAtMs", link.accessExpiresAtMs)
            put("refreshToken", link.refreshToken); put("refreshExpiresAtMs", link.refreshExpiresAtMs)
        })
        if (installId != null) json.put("installId", installId)
        if (entitlements != null) json.put("entitlements", entitlements)
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeBytes(box.encrypt(json.toString().toByteArray(Charsets.UTF_8)))
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }

    private fun readLink(o: JSONObject) = Link(
        apiUrl = o.getString("apiUrl"), allowHttp = o.optBoolean("allowHttp"), userId = o.getString("userId"), displayName = o.optString("displayName"),
        accessToken = o.getString("accessToken"), accessExpiresAtMs = o.getLong("accessExpiresAtMs"),
        refreshToken = o.getString("refreshToken"), refreshExpiresAtMs = o.getLong("refreshExpiresAtMs"),
    )

    companion object {
        fun forContext(context: Context) = KeyboardStore(File(context.noBackupFilesDir, "azlinqext.bin"), KeystoreBox())
    }
}
