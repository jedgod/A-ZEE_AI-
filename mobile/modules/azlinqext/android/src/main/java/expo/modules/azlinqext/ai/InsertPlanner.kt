package expo.modules.azlinqext.ai

/** The only things the AI side may do to a text field: read, delete the text it replaces, and type. It cannot send, submit or press any key. */
interface EditorPort {
    fun selectedText(): String?
    fun textBeforeCursor(maxChars: Int): String?
    fun deleteSurrounding(before: Int, after: Int): Boolean
    fun commit(text: String): Boolean
}

enum class SourceKind { SELECTION, BEFORE_CURSOR, CLIPBOARD }

/** The text a suggestion was made from, and where it came from. */
data class Draft(val kind: SourceKind, val text: String)

enum class InsertOutcome { INSERTED, SOURCE_CHANGED, FAILED }

/**
 * Puts a chosen reply into the field, only when the user taps it, and only if the text it replaces
 * is still exactly what was sent. If the field changed in the meantime (the user typed, moved the
 * cursor or switched apps) nothing is inserted. It never presses Enter, never sends, and never
 * calls any send or editor action.
 */
object InsertPlanner {
    const val MAX_REPLY_CHARS = 3000

    fun clean(reply: String): String = reply.filter { it == '\n' || !it.isISOControl() }.trim().take(MAX_REPLY_CHARS)

    fun insert(editor: EditorPort, draft: Draft, reply: String): InsertOutcome {
        val text = clean(reply)
        if (text.isEmpty()) return InsertOutcome.FAILED
        return when (draft.kind) {
            SourceKind.SELECTION -> {
                if (editor.selectedText() != draft.text) return InsertOutcome.SOURCE_CHANGED
                if (editor.commit(text)) InsertOutcome.INSERTED else InsertOutcome.FAILED // typing over a selection replaces it
            }
            SourceKind.BEFORE_CURSOR -> {
                if (!editor.selectedText().isNullOrEmpty()) return InsertOutcome.SOURCE_CHANGED
                if (editor.textBeforeCursor(draft.text.length) != draft.text) return InsertOutcome.SOURCE_CHANGED
                if (!editor.deleteSurrounding(draft.text.length, 0)) return InsertOutcome.FAILED
                if (editor.commit(text)) InsertOutcome.INSERTED else InsertOutcome.FAILED
            }
            SourceKind.CLIPBOARD -> if (editor.commit(text)) InsertOutcome.INSERTED else InsertOutcome.FAILED
        }
    }
}
