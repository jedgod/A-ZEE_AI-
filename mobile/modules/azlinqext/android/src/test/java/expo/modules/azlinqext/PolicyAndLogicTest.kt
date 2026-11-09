package expo.modules.azlinqext

import android.text.InputType
import android.view.inputmethod.EditorInfo
import expo.modules.azlinqext.ai.Draft
import expo.modules.azlinqext.ai.FieldPolicy
import expo.modules.azlinqext.ai.InsertOutcome
import expo.modules.azlinqext.ai.InsertPlanner
import expo.modules.azlinqext.ai.SourceKind
import expo.modules.azlinqext.ime.Key
import expo.modules.azlinqext.ime.KeyboardLogic
import expo.modules.azlinqext.ime.KeyboardState
import expo.modules.azlinqext.ime.Layer
import expo.modules.azlinqext.ime.Output
import expo.modules.azlinqext.ime.Shift
import org.junit.Assert.*
import org.junit.Test

class FieldPolicyTest {
    private val text = InputType.TYPE_CLASS_TEXT
    @Test fun messageAndNormalFieldsAllowAi() {
        assertTrue(FieldPolicy.aiAllowed(text or InputType.TYPE_TEXT_VARIATION_SHORT_MESSAGE, 0))
        assertTrue(FieldPolicy.aiAllowed(text or InputType.TYPE_TEXT_FLAG_MULTI_LINE, 0))
        assertTrue(FieldPolicy.aiAllowed(text or InputType.TYPE_TEXT_VARIATION_EMAIL_SUBJECT, 0))
    }
    @Test fun passwordsAreNeverReadOrSent() {
        for (v in listOf(InputType.TYPE_TEXT_VARIATION_PASSWORD, InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD, InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD)) {
            assertFalse(FieldPolicy.aiAllowed(text or v, 0)); assertTrue(FieldPolicy.isSecret(text or v))
        }
        assertFalse(FieldPolicy.aiAllowed(InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD, 0))
        assertTrue(FieldPolicy.isSecret(InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD))
    }
    @Test fun otherPersonalFieldsAreOff() {
        for (v in listOf(InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS, InputType.TYPE_TEXT_VARIATION_URI,
            InputType.TYPE_TEXT_VARIATION_PERSON_NAME, InputType.TYPE_TEXT_VARIATION_POSTAL_ADDRESS)) assertFalse(FieldPolicy.aiAllowed(text or v, 0))
        assertFalse(FieldPolicy.aiAllowed(InputType.TYPE_CLASS_NUMBER, 0))
        assertFalse(FieldPolicy.aiAllowed(InputType.TYPE_CLASS_PHONE, 0))
        assertFalse(FieldPolicy.aiAllowed(InputType.TYPE_NULL, 0))
    }
    @Test fun incognitoFieldsAreOff() {
        assertFalse(FieldPolicy.aiAllowed(text, EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING))
        assertFalse(FieldPolicy.isSecret(text or InputType.TYPE_TEXT_VARIATION_SHORT_MESSAGE))
    }
}

class InsertPlannerTest {
    @Test fun selectionIsReplacedOnlyWhileItIsStillTheSameSelection() {
        val e = FakeEditor("hello can you come? thanks", 6, 19)
        val draft = Draft(SourceKind.SELECTION, "can you come?")
        assertEquals(InsertOutcome.INSERTED, InsertPlanner.insert(e, draft, "Yes, I'll be there."))
        assertEquals("hello Yes, I'll be there. thanks", e.text)
    }
    @Test fun aChangedSelectionInsertsNothing() {
        val e = FakeEditor("hello can you come? thanks", 0, 5)           // user selected something else
        assertEquals(InsertOutcome.SOURCE_CHANGED, InsertPlanner.insert(e, Draft(SourceKind.SELECTION, "can you come?"), "Yes"))
        assertEquals(0, e.writes); assertEquals("hello can you come? thanks", e.text)
    }
    @Test fun typedMessageIsReplacedOnlyIfUnchanged() {
        val e = FakeEditor("can you come?")
        assertEquals(InsertOutcome.INSERTED, InsertPlanner.insert(e, Draft(SourceKind.BEFORE_CURSOR, "can you come?"), "Yes!"))
        assertEquals("Yes!", e.text)
        val edited = FakeEditor("can you come? soon")                      // user kept typing after Suggest
        assertEquals(InsertOutcome.SOURCE_CHANGED, InsertPlanner.insert(edited, Draft(SourceKind.BEFORE_CURSOR, "can you come?"), "Yes!"))
        assertEquals(0, edited.writes)
    }
    @Test fun aSelectionAppearingMeansTheFieldChanged() {
        val e = FakeEditor("can you come?", 0, 3)
        assertEquals(InsertOutcome.SOURCE_CHANGED, InsertPlanner.insert(e, Draft(SourceKind.BEFORE_CURSOR, "can you come?"), "Yes"))
        assertEquals(0, e.writes)
    }
    @Test fun clipboardRepliesAreTypedAtTheCursor() {
        val e = FakeEditor("Hi ")
        assertEquals(InsertOutcome.INSERTED, InsertPlanner.insert(e, Draft(SourceKind.CLIPBOARD, "anything"), "Sounds good."))
        assertEquals("Hi Sounds good.", e.text)
    }
    @Test fun repliesAreCleanedAndEmptyOnesRefused() {
        assertEquals("a b\nc", InsertPlanner.clean("\u0000a\u0007 b\nc\u001b "))
        assertEquals(InsertPlanner.MAX_REPLY_CHARS, InsertPlanner.clean("x".repeat(9999)).length)
        val e = FakeEditor("hi")
        assertEquals(InsertOutcome.FAILED, InsertPlanner.insert(e, Draft(SourceKind.CLIPBOARD, "x"), " \u0000 "))
        assertEquals(0, e.writes)
    }
}

class KeyboardLogicTest {
    private fun type(state: KeyboardState, vararg keys: Key): Pair<KeyboardState, String> {
        var s = state; val out = StringBuilder()
        for (k in keys) { val (n, o) = KeyboardLogic.press(s, k); s = n; if (o is Output.Commit) out.append(o.text) }
        return s to out.toString()
    }
    @Test fun typesLettersSpacesAndPunctuation() {
        val (_, text) = type(KeyboardState(), Key.Char("h"), Key.Char("i"), Key.Char(","), Key.Space, Key.Char("y"), Key.Char("o"), Key.Char("u"), Key.Char("."))
        assertEquals("hi, you.", text)
    }
    @Test fun shiftCapitalisesOneLetterThenResets() {
        val (s, _) = KeyboardLogic.press(KeyboardState(), Key.Shift)
        assertEquals(Shift.ONCE, s.shift)
        val rows = KeyboardLogic.rows(s, "↵")
        assertEquals("Q", rows[0][0].label)
        val (after, out) = KeyboardLogic.press(s, Key.Char("Q"))
        assertEquals(Shift.OFF, after.shift); assertEquals(Output.Commit("Q"), out)
    }
    @Test fun capsLockStaysOnUntilTurnedOff() {
        var s = KeyboardLogic.press(KeyboardLogic.press(KeyboardState(), Key.Shift).first, Key.Shift).first
        assertEquals(Shift.LOCK, s.shift)
        s = KeyboardLogic.press(s, Key.Char("A")).first
        assertEquals(Shift.LOCK, s.shift)
        assertEquals(Shift.OFF, KeyboardLogic.press(s, Key.Shift).first.shift)
    }
    @Test fun layersSwitchAndHaveEveryKeyTheKeyboardNeeds() {
        val letters = KeyboardLogic.rows(KeyboardState(), "Send")
        val all = letters.flatten().map { it.label }
        assertTrue(all.containsAll(listOf("q", "p", "m", "⌫", ",", ".", "Send", "?123")))
        assertEquals(26, letters.flatten().count { it.key is Key.Char && it.label.length == 1 && it.label[0].isLetter() })
        assertTrue(letters.flatten().any { it.key is Key.Space })
        val numbers = KeyboardState(Layer.NUMBERS)
        assertEquals(Layer.NUMBERS, KeyboardLogic.press(KeyboardState(), Key.ToNumbers).first.layer)
        assertTrue(KeyboardLogic.rows(numbers, "↵")[0].map { it.label } == "1234567890".map { it.toString() })
        assertEquals(Layer.LETTERS, KeyboardLogic.press(numbers, Key.ToLetters).first.layer)
        assertEquals(Layer.SYMBOLS, KeyboardLogic.press(numbers, Key.ToSymbols).first.layer)
    }
    @Test fun everyLayerHasAKeyToSwitchToAnotherKeyboard() {
        for (layer in Layer.values()) {
            val bottom = KeyboardLogic.rows(KeyboardState(layer), "Send").last()
            assertTrue("no switch-keyboard key on $layer", bottom.any { it.key == Key.Globe && it.description == "Switch keyboard" })
            assertTrue("Send/Enter must stay on the bottom row on $layer", bottom.any { it.key == Key.Enter })
        }
    }
    @Test fun backspaceEnterAndGlobeProduceTheirActions() {
        assertEquals(Output.DeleteBackward, KeyboardLogic.press(KeyboardState(), Key.Backspace).second)
        assertEquals(Output.Enter, KeyboardLogic.press(KeyboardState(), Key.Enter).second)
        assertEquals(Output.SwitchKeyboard, KeyboardLogic.press(KeyboardState(), Key.Globe).second)
    }
    @Test fun everyKeyIsLabelledForScreenReaders() {
        for (layer in Layer.values()) KeyboardLogic.rows(KeyboardState(layer), "Go").flatten().forEach { assertTrue("missing description on ${it.label}", it.description.isNotBlank()) }
    }
}

/** The AI bar appears only in the supported messaging apps. */
class SupportedAppsTest {
    @Test fun theMessagingAppsAreSupported() {
        listOf("com.whatsapp", "com.whatsapp.w4b", "com.linkedin.android", "org.telegram.messenger", "org.thoughtcrime.securesms")
            .forEach { assertTrue(it, expo.modules.azlinqext.ai.SupportedApps.supports(it)) }
    }
    @Test fun everythingElseIsNot_includingA_ZeeItself() {
        listOf("com.azee.app", "com.android.chrome", "com.google.android.gm", "com.samsung.android.messaging", "android", "")
            .forEach { assertFalse(it, expo.modules.azlinqext.ai.SupportedApps.supports(it)) }
        assertFalse(expo.modules.azlinqext.ai.SupportedApps.supports(null))
    }
    @Test fun lookAlikePackagesNeverQualify() {
        listOf("com.whatsapp.fake", "com.whatsapp ", "COM.WHATSAPP", "evil.com.whatsapp", "com.linkedin.android.evil")
            .forEach { assertFalse(it, expo.modules.azlinqext.ai.SupportedApps.supports(it)) }
    }
}
