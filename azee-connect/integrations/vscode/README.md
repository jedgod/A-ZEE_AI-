# AZee Connect for VS Code

Explain, review, and ask about code using your own AZ_AI server.

1. On the server machine: `npm run connect:token -- --local` (copy the token).
2. In VS Code: **AZee: Configure API access** → server URL + token. The token is checked, then kept in VS Code SecretStorage.
3. Select code (or nothing, for the whole file) and use **AZee: Explain code**, **Review code for bugs**, or **Ask about this code…** (Ctrl+Alt+A) from the Command Palette or the editor right-click menu.

Answers open as Markdown beside your code. Code is only sent after you confirm (or choose “Always send”). **AZee: Forget token on this machine** removes the stored token.
