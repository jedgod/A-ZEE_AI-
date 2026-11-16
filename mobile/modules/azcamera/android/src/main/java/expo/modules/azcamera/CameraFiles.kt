package expo.modules.azcamera

import java.io.File

/** Naming and tidying for the photos the camera writes. Plain Kotlin so it can be unit-tested without Android. */
object CameraFiles {
    const val FOLDER = "azcamera"
    private const val PREFIX = "photo-"
    private const val SUFFIX = ".jpg"
    private const val KEEP_MS = 24L * 60 * 60 * 1000
    private const val MAX_FILES = 8

    fun newName(nowMs: Long): String = "$PREFIX$nowMs$SUFFIX"

    /** Deletes photos older than a day and, beyond that, all but the newest few, so storage never fills up. Only touches our own files. */
    fun tidy(dir: File, nowMs: Long) {
        val ours = dir.listFiles { f -> f.isFile && (f.name.startsWith(PREFIX) || f.name.startsWith("shared-")) }?.sortedByDescending { it.lastModified() } ?: return
        ours.forEachIndexed { i, f -> if (i >= MAX_FILES || nowMs - f.lastModified() > KEEP_MS) f.delete() }
    }

    private const val MAX_SHARED_BYTES = 15L * 1024 * 1024
    private val EXTENSIONS = mapOf("image/jpeg" to "jpg", "image/jpg" to "jpg", "image/png" to "png", "image/webp" to "webp", "image/heic" to "heic", "image/heif" to "heif", "image/gif" to "gif")

    /** Only real image types are taken from other apps; anything else (video, text, a file named like an image) is ignored. */
    fun acceptsShared(mime: String?): Boolean = mime != null && EXTENSIONS.containsKey(mime.lowercase().substringBefore(';').trim())
    fun sharedName(nowMs: Long, mime: String?): String = "shared-$nowMs." + (EXTENSIONS[mime?.lowercase()?.substringBefore(';')?.trim()] ?: "jpg")
    fun withinSharedLimit(bytes: Long): Boolean = bytes in 1..MAX_SHARED_BYTES

    /** A camera app that was cancelled can leave a zero-byte file behind. */
    fun usable(file: File): Boolean = file.isFile && file.length() > 0
}
