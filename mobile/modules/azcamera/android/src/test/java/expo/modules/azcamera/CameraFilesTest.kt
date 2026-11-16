package expo.modules.azcamera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class CameraFilesTest {
    private fun tmp(): File = Files.createTempDirectory("azcam").toFile()
    private fun photo(dir: File, name: String, ageMs: Long, now: Long, bytes: Int = 10) =
        File(dir, name).apply { writeBytes(ByteArray(bytes)); setLastModified(now - ageMs) }

    @Test fun namesAreJpegsWithTheTime() = assertEquals("photo-123.jpg", CameraFiles.newName(123))

    @Test fun oldPhotosAreRemovedAndOtherFilesAreLeftAlone() {
        val d = tmp(); val now = 10_000_000_000L
        val old = photo(d, "photo-1.jpg", 2L * 24 * 3600 * 1000, now)
        val fresh = photo(d, "photo-2.jpg", 1000, now)
        val other = photo(d, "notes.txt", 5L * 24 * 3600 * 1000, now)
        CameraFiles.tidy(d, now)
        assertFalse(old.exists()); assertTrue(fresh.exists()); assertTrue(other.exists())
    }

    @Test fun onlyTheNewestFewAreKept() {
        val d = tmp(); val now = 10_000_000_000L
        val files = (1..12).map { photo(d, "photo-$it.jpg", it * 1000L, now) }
        CameraFiles.tidy(d, now)
        assertEquals(8, files.count { it.exists() })
        assertTrue(files[0].exists()); assertFalse(files[11].exists())
    }

    @Test fun anEmptyFileIsNotAPhoto() {
        val d = tmp()
        assertFalse(CameraFiles.usable(File(d, "missing.jpg")))
        assertFalse(CameraFiles.usable(photo(d, "photo-5.jpg", 0, 0, bytes = 0)))
        assertTrue(CameraFiles.usable(photo(d, "photo-6.jpg", 0, 0, bytes = 5)))
    }

    @Test fun onlyRealImageTypesAreAcceptedFromOtherApps() {
        assertTrue(CameraFiles.acceptsShared("image/jpeg")); assertTrue(CameraFiles.acceptsShared("IMAGE/PNG; charset=x")); assertTrue(CameraFiles.acceptsShared("image/heic"))
        assertFalse(CameraFiles.acceptsShared("video/mp4")); assertFalse(CameraFiles.acceptsShared("text/plain")); assertFalse(CameraFiles.acceptsShared("image/svg+xml")); assertFalse(CameraFiles.acceptsShared(null))
    }

    @Test fun sharedFilesGetASafeNameFromTheTypeNotFromTheSender() {
        assertEquals("shared-5.png", CameraFiles.sharedName(5, "image/png"))
        assertEquals("shared-5.jpg", CameraFiles.sharedName(5, "image/unknown"))
        assertEquals("shared-5.jpg", CameraFiles.sharedName(5, null))
    }

    @Test fun sharedPicturesAreLimitedTo15MegabytesAndMustNotBeEmpty() {
        assertFalse(CameraFiles.withinSharedLimit(0)); assertTrue(CameraFiles.withinSharedLimit(1)); assertTrue(CameraFiles.withinSharedLimit(15L * 1024 * 1024)); assertFalse(CameraFiles.withinSharedLimit(15L * 1024 * 1024 + 1))
    }

    @Test fun tidyAlsoClearsOldSharedPictures() {
        val d = tmp(); val now = 10_000_000_000L
        val old = photo(d, "shared-1.png", 3L * 24 * 3600 * 1000, now); val fresh = photo(d, "shared-2.png", 1000, now)
        CameraFiles.tidy(d, now)
        assertFalse(old.exists()); assertTrue(fresh.exists())
    }
}
