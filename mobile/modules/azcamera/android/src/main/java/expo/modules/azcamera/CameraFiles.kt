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
        val ours = dir.listFiles { f -> f.isFile && f.name.startsWith(PREFIX) && f.name.endsWith(SUFFIX) }?.sortedByDescending { it.lastModified() } ?: return
        ours.forEachIndexed { i, f -> if (i >= MAX_FILES || nowMs - f.lastModified() > KEEP_MS) f.delete() }
    }

    /** A camera app that was cancelled can leave a zero-byte file behind. */
    fun usable(file: File): Boolean = file.isFile && file.length() > 0
}
