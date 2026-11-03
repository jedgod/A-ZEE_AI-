// Reviewed, versioned few-shot registry for 06_PROMPT_ENGINE/few_shot_examples.
// Used for structured (JSON) answers so models return exactly the 06 structured_output_spec shape.
// Keep examples free of sensitive data; they count against the prompt budget.

export const FEW_SHOT_VERSION = "1.0.0";

export const FEW_SHOT_REGISTRY = [
  {
    id: "json-answer-basic",
    input: "What does HTTP status 404 mean?",
    output: JSON.stringify({ answer: "404 Not Found means the server has no resource at the requested URL.", citations: [], warnings: [] }),
  },
  {
    id: "json-answer-caveat",
    input: "Is this regex safe for emails? ^.+@.+$",
    output: JSON.stringify({
      answer: "It matches most emails but also accepts invalid ones like `a@b`. Validate by sending a confirmation email instead.",
      citations: [],
      warnings: ["Regex validation cannot prove an address exists."],
    }),
  },
];

export const STRUCTURED_EXAMPLE_IDS = ["json-answer-basic", "json-answer-caveat"];
