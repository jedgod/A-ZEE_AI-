package expo.modules.azlinqext

import expo.modules.azlinqext.autopilot.AutopilotMode
import expo.modules.azlinqext.autopilot.AutopilotPolicy
import expo.modules.azlinqext.autopilot.AutopilotSettings
import expo.modules.azlinqext.autopilot.Contact
import expo.modules.azlinqext.autopilot.Decision
import expo.modules.azlinqext.autopilot.Incoming
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AutopilotPolicyTest {
    private val bishop = Contact("Bishop Anthony", "professional")
    private fun settings(mode: AutopilotMode, paused: Boolean = false) = AutopilotSettings(mode = mode, contacts = listOf(bishop, Contact("Ama", "friend")), paused = paused)
    private fun msg(sender: String = "Bishop Anthony", text: String = "Are you coming to the meeting?", group: Boolean = false) = Incoming(sender, text, group)

    @Test fun offAndPausedDoNothing() {
        assertTrue(AutopilotPolicy.decide(settings(AutopilotMode.OFF), msg()) is Decision.Ignore)
        assertTrue(AutopilotPolicy.decide(settings(AutopilotMode.DRAFT, paused = true), msg()) is Decision.Ignore)
    }

    @Test fun draftModeDraftsForEveryOneToOneConversation() {
        assertEquals(Decision.Draft("professional"), AutopilotPolicy.decide(settings(AutopilotMode.DRAFT), msg()))
        assertEquals(Decision.Draft("casual"), AutopilotPolicy.decide(settings(AutopilotMode.DRAFT), msg(sender = "Stranger")))
    }

    @Test fun selectedModeDraftsOnlyForListedConversations() {
        assertTrue(AutopilotPolicy.decide(settings(AutopilotMode.SELECTED), msg(sender = "bishop  anthony")) is Decision.Draft)
        assertTrue(AutopilotPolicy.decide(settings(AutopilotMode.SELECTED), msg(sender = "Stranger")) is Decision.Ignore)
        assertTrue(AutopilotPolicy.decide(settings(AutopilotMode.SELECTED), msg(sender = "Bishop")) is Decision.Ignore) // not an exact name
    }

    @Test fun groupsAndSensitiveMessagesAreNeverProcessed() {
        assertTrue(AutopilotPolicy.decide(settings(AutopilotMode.DRAFT), msg(group = true)) is Decision.Ignore)
        listOf("Your verification code is 482913", "send me your password", "Please wire transfer the money", "I need urgent help", "3 new messages").forEach {
            assertTrue(it, AutopilotPolicy.decide(settings(AutopilotMode.DRAFT), msg(text = it)) is Decision.Ignore)
        }
    }

    @Test fun toneFollowsTheContactKind() {
        assertEquals("casual", (AutopilotPolicy.decide(settings(AutopilotMode.DRAFT), msg(sender = "Ama")) as Decision.Draft).tone)
        assertEquals("professional", (AutopilotPolicy.decide(settings(AutopilotMode.DRAFT), msg()) as Decision.Draft).tone)
    }

    @Test fun aDraftThatAddsDetailsIsFlaggedForTheReviewScreen() {
        val m = "Can we meet on 20 November at 10:30?"
        assertTrue(AutopilotPolicy.draftAddsNoDetails(m, "Yes, 20 November at 10:30 works for me."))
        assertFalse(AutopilotPolicy.draftAddsNoDetails(m, "Sorry, I can do November 30 instead."))
        assertFalse(AutopilotPolicy.draftAddsNoDetails(m, "See https://example.com"))
        assertFalse(AutopilotPolicy.draftAddsNoDetails(m, ""))
    }

    @Test fun anOldSavedAutoSendChoiceBecomesDraftOnly() {
        assertEquals(AutopilotMode.DRAFT, AutopilotSettings.parse(JSONObject("""{"mode":"everyone","autoSendConsent":true}""")).mode)
        assertEquals(AutopilotMode.OFF, AutopilotMode.of("nonsense"))
    }

    @Test fun settingsRoundTripAndRejectBadValues() {
        val s = AutopilotSettings(mode = AutopilotMode.SELECTED, contacts = listOf(bishop, Contact("bishop anthony", "friend")), digestMinutes = 45)
        val back = AutopilotSettings.parse(s.toJson())
        assertEquals(1, back.contacts.size)          // duplicates by normalised name collapse
        assertEquals(0, back.digestMinutes)          // only the offered intervals are accepted
    }

    /** Nothing may hand text to a chat app except the review screen's Send. Reads the source so a later change can't quietly add another path. */
    @Test fun onlyTheReviewSendCanHandTextToAChatApp() {
        val src = File("src/main/java/expo/modules/azlinqext/autopilot/Autopilot.kt").readText()
        assertEquals("handOver is called once, from reviewSend", 1, Regex("""handOver\(ctx, action, body\)""").findAll(src).count())
        assertEquals(2, Regex("handOver\\(").findAll(src).count()) // the definition and that one call
        val listener = src.substringAfter("class AzNotificationListener").substringBefore("class AutopilotReceiver")
        assertFalse("the listener must not send", listener.contains("handOver") || listener.contains("reviewSend") || listener.contains("actionIntent"))
        val module = File("src/main/java/expo/modules/azlinqext/AzLinqextModule.kt").readText()
        assertEquals(1, Regex("reviewSend\\(").findAll(module).count())
    }
}
