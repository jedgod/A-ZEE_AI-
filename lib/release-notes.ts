// Release notes shown under Help → Release notes. Newest first; keep entries factual.
export const RELEASE_NOTES: { date: string; title: string; items: string[] }[] = [
  {
    date: "2026-11-02",
    title: "Accounts, support, and the operations workspace",
    items: [
      "Account menu in the sidebar: profile, personalization, plan, help, and keyboard shortcuts.",
      "Report a bug or contact support from the Help menu; follow your requests and their resolutions.",
      "Operations workspace for staff: complaint queue, assignment, resolutions, and admin approval.",
      "Personalization: custom instructions and answer style are applied to every answer.",
    ],
  },
  {
    date: "2026-11-02",
    title: "Pipeline stages 00–15",
    items: [
      "Every request runs through preflight, routing with provider fallback, prompt policy, and validation.",
      "Rate answers with 👍/👎 and suggest corrections; see activity on the Insights page.",
      "Personal data is masked before it reaches an AI provider and restored in the answer.",
    ],
  },
  {
    date: "2026-11-01",
    title: "Development canvas and sharing",
    items: [
      "Preview generated HTML, CSS, and JavaScript in an isolated canvas.",
      "Share a project by link or email; move chats between projects.",
      "VS Code extension and a command-line tool for other editors (AZee Connect).",
    ],
  },
];

export const KEYBOARD_SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Enter", action: "Send message" },
  { keys: "Shift + Enter", action: "New line" },
  { keys: "Ctrl + /", action: "Show keyboard shortcuts" },
  { keys: "Esc", action: "Close menus, dialogs, and the canvas" },
];
