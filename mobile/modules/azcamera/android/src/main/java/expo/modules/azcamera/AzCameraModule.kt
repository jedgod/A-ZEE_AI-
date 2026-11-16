package expo.modules.azcamera

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.provider.MediaStore
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

private const val TAKE_PHOTO_CODE = 4291

/**
 * Takes one photo with the phone's own camera app and hands it back to the A-Zee app as a file in its private storage.
 * The camera app does the capturing, so this needs no camera permission, and it never sees anything but the picture
 * the user chose to keep. Nothing is uploaded here: the app decides what to do with the file.
 */
class AzCameraModule : Module() {
    private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    private var pending: Promise? = null
    private var pendingFile: File? = null

    override fun definition() = ModuleDefinition {
        Name("AzCamera")

        /** Opens the camera. Resolves { uri, width, height, size } or null when the user cancels. */
        AsyncFunction("takePhoto") { promise: Promise ->
            if (pending != null) throw CodedException("E_BUSY", "The camera is already open.", null)
            // Private storage, not the cache: Android empties the cache when space is low, which would delete the photo.
            val dir = File(context.filesDir, CameraFiles.FOLDER).apply { mkdirs() }
            CameraFiles.tidy(dir, System.currentTimeMillis())
            val file = File(dir, CameraFiles.newName(System.currentTimeMillis()))
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.azcamera.fileprovider", file)
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                clipData = ClipData.newRawUri("photo", uri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            if (intent.resolveActivity(context.packageManager) == null) throw CodedException("E_NO_CAMERA", "No camera app was found on this phone.", null)
            pending = promise
            pendingFile = file
            try {
                appContext.throwingActivity.startActivityForResult(intent, TAKE_PHOTO_CODE)
            } catch (e: Exception) {
                pending = null
                pendingFile = null
                throw CodedException("E_CAMERA_FAILED", e.message ?: "The camera could not be opened.", e)
            }
        }

        OnActivityResult { _, (requestCode, resultCode, _) ->
            if (requestCode != TAKE_PHOTO_CODE) return@OnActivityResult
            val promise = pending ?: return@OnActivityResult
            val file = pendingFile
            pending = null
            pendingFile = null
            if (resultCode != Activity.RESULT_OK || file == null) {
                file?.delete()
                promise.resolve(null)
                return@OnActivityResult
            }
            if (!CameraFiles.usable(file)) {
                file.delete()
                promise.reject(CodedException("E_NO_PHOTO", "The photo could not be saved. The phone may be low on storage.", null))
                return@OnActivityResult
            }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            promise.resolve(mapOf("uri" to "file://${file.absolutePath}", "width" to bounds.outWidth, "height" to bounds.outHeight, "size" to file.length()))
        }
    }
}
