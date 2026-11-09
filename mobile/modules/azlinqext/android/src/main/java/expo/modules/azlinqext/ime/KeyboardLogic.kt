package expo.modules.azlinqext.ime

/** What the on-screen keys do, with no Android in it so it can be tested directly. */

enum class Layer { LETTERS, NUMBERS, SYMBOLS }
enum class Shift { OFF, ONCE, LOCK }

data class KeyboardState(val layer: Layer = Layer.LETTERS, val shift: Shift = Shift.OFF)

sealed class Key {
    data class Char(val value: String) : Key()
    object Shift : Key()
    object Backspace : Key()
    object Space : Key()
    object Enter : Key()
    object Globe : Key()
    object ToNumbers : Key()
    object ToLetters : Key()
    object ToSymbols : Key()
}

/** What a key press asks the keyboard to do to the text field. */
sealed class Output {
    data class Commit(val text: String) : Output()
    object DeleteBackward : Output()
    object Enter : Output()
    object SwitchKeyboard : Output()
    object None : Output()
}

data class KeySpec(val label: String, val description: String, val key: Key, val weight: Float = 1f)

object KeyboardLogic {
    private val letterRows = listOf("qwertyuiop", "asdfghjkl", "zxcvbnm")
    private val numberRows = listOf("1234567890", "@#$%&-+()/", "*\"':;!?")
    private val symbolRows = listOf("~`|•√π÷×¶∆", "£¢€¥^°={}\\", "©®™✓[]<>")

    fun rows(state: KeyboardState, enterLabel: String): List<List<KeySpec>> {
        val chars = { row: String, upper: Boolean -> row.map { c -> val s = if (upper) c.uppercaseChar().toString() else c.toString(); KeySpec(s, s, Key.Char(s)) } }
        val bottom = listOf(
            KeySpec(if (state.layer == Layer.LETTERS) "?123" else "ABC", if (state.layer == Layer.LETTERS) "Switch to numbers and symbols" else "Switch to letters",
                if (state.layer == Layer.LETTERS) Key.ToNumbers else Key.ToLetters, 1.4f),
            KeySpec(",", "Comma", Key.Char(",")),
            KeySpec("", "Space", Key.Space, 4f),
            KeySpec(".", "Period", Key.Char(".")),
            KeySpec(enterLabel, "Enter, $enterLabel", Key.Enter, 1.4f),
        )
        val upper = state.shift != Shift.OFF
        return when (state.layer) {
            Layer.LETTERS -> listOf(
                chars(letterRows[0], upper), chars(letterRows[1], upper),
                listOf(KeySpec(if (state.shift == Shift.LOCK) "⇪" else "⇧", shiftDescription(state.shift), Key.Shift, 1.4f)) + chars(letterRows[2], upper) + KeySpec("⌫", "Backspace", Key.Backspace, 1.4f),
                bottom,
            )
            Layer.NUMBERS -> listOf(
                chars(numberRows[0], false), chars(numberRows[1], false),
                listOf(KeySpec("=\\<", "More symbols", Key.ToSymbols, 1.4f)) + chars(numberRows[2], false) + KeySpec("⌫", "Backspace", Key.Backspace, 1.4f),
                bottom,
            )
            Layer.SYMBOLS -> listOf(
                chars(symbolRows[0], false), chars(symbolRows[1], false),
                listOf(KeySpec("?123", "Back to numbers", Key.ToNumbers, 1.4f)) + chars(symbolRows[2], false) + KeySpec("⌫", "Backspace", Key.Backspace, 1.4f),
                bottom,
            )
        }
    }

    private fun shiftDescription(shift: Shift) = when (shift) {
        Shift.OFF -> "Shift"
        Shift.ONCE -> "Shift on for the next letter"
        Shift.LOCK -> "Caps lock on"
    }

    /** The next state and the action for [key]. Shift applies to one letter, then switches itself off, unless caps lock is on. */
    fun press(state: KeyboardState, key: Key): Pair<KeyboardState, Output> = when (key) {
        is Key.Char -> {
            val letter = key.value.length == 1 && key.value[0].isLetter()
            Pair(if (state.shift == Shift.ONCE && letter) state.copy(shift = Shift.OFF) else state, Output.Commit(key.value))
        }
        Key.Space -> Pair(state, Output.Commit(" "))
        Key.Backspace -> Pair(state, Output.DeleteBackward)
        Key.Enter -> Pair(state, Output.Enter)
        Key.Globe -> Pair(state, Output.SwitchKeyboard)
        Key.Shift -> Pair(state.copy(shift = when (state.shift) { Shift.OFF -> Shift.ONCE; Shift.ONCE -> Shift.LOCK; Shift.LOCK -> Shift.OFF }), Output.None)
        Key.ToNumbers -> Pair(state.copy(layer = Layer.NUMBERS), Output.None)
        Key.ToSymbols -> Pair(state.copy(layer = Layer.SYMBOLS), Output.None)
        Key.ToLetters -> Pair(state.copy(layer = Layer.LETTERS), Output.None)
    }
}
