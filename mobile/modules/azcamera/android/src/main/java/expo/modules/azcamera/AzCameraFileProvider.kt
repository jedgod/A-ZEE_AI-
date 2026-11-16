package expo.modules.azcamera

import androidx.core.content.FileProvider

/** A FileProvider of our own, so it cannot clash with another library's provider in the merged manifest. */
class AzCameraFileProvider : FileProvider()
