# 03_CONTEXT (Python)

Gathers what the model should know for a request and fits it into a character budget.

| Module | Purpose |
|---|---|
| `session_memory/` | Per-session history (capped per session); `summarize()` for the prompt. |
| `long_term_memory/` | Key/value facts with importance; word-overlap search; evicts the least important item when full. |
| `document_retrieval/` | `DocumentStore` protocol, plus an in-memory keyword store (whole words, stopwords ignored, titles weighted). |
| `tool_context/` | Records tool calls; clips large results; `render()` for the prompt. |
| `web_retrieval/` | Pluggable `WebSearchProvider`. **Disabled (returns nothing) until you configure a provider**, so no invented results reach the model. |
| `context_compaction/` | Priority-ordered sections; trims the first section that overflows, from its end or its start. |
| `context_pipeline/` | `ContextPipeline` orchestrator: conversation → memories → tools → documents → web. |

Needs `02_PREPROCESS` on the path too (for `azai_core`):

```powershell
python 03_CONTEXT/example.py                                # preprocess + context, end to end
python -m unittest discover -s 03_CONTEXT/tests
```

In-memory stores are for development and tests. For production, implement the same
interfaces on PostgreSQL (session and long-term memory), a vector store (documents), and a
real search API (web).
