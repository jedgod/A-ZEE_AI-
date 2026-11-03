# AZee Connect — use AZ_AI from your editor

AZee Connect lets development environments (VS Code, Code::Blocks, Visual Studio,
JetBrains IDEs, Vim/Neovim, Emacs, Notepad++, Sublime Text, …) send code to your
AZ_AI server and get an explanation, review, or answer back.

```
 Editor / IDE ──► VS Code extension ─┐
                  azee CLI ──────────┼─► https://your-host/api/v1/*  ──► AI providers
                  your own HTTP call ┘      (token auth, PostgreSQL)
```

| Path | What it is |
|---|---|
| `GET  /api/v1/status` | Checks a token; returns key ID, scopes, expiry, modes, size limit. Doesn't call the AI. |
| `POST /api/v1/chat` | `{ mode, model?, messages }` → `{ data: { answer } }` (Markdown). |
| `azee-connect/cli/` | `azee` command-line client — zero dependencies, any editor that can run a command. |
| `azee-connect/integrations/vscode/` | VS Code extension (`azee-connect-0.2.0.vsix`). |
| `azee-connect/integrations/sdk/azee.ts` | Minimal TypeScript client for your own tools. |
| `scripts/connect-token.cjs` | Issues, lists, and revokes tokens (`npm run connect:token`). |

The live routes are in the main app (`app/api/v1/`, `lib/platform/auth.ts`).
`azee-connect/app` and `azee-connect/lib` are the original drafts and aren't served.

## 1. Get a token (once per machine or editor)

On the machine running AZ_AI, from `AZ_AI/`:

```powershell
npm run connect:token -- --local            # creates a "Local developer" in "Local workspace" if needed
npm run connect:token -- --local --days 7   # 1–90 days, default 30
npm run connect:token -- --list             # see tokens and whether they're active
npm run connect:token -- --revoke KEY_ID    # stop a token immediately
```

The token (`az_` + 64 hex characters) is shown **once**; only its SHA-256 hash is stored.
For a real account, use `--user USER_UUID --tenant TENANT_UUID` instead of `--local`.
Tokens can only chat (`chat:write`); they never grant admin access.

## 2. Set up the CLI (used by every editor except VS Code)

Requires Node 18+. From `AZ_AI/`:

```powershell
node azee-connect\cli\azee.mjs configure --url http://localhost:3000 --token az_...
node azee-connect\cli\azee.mjs status
```

`configure` checks the token against the server before saving it to
`%APPDATA%\azee\config.json` (Windows) or `~/.config/azee/config.json`.
Alternatively set `AZEE_URL` and `AZEE_TOKEN` environment variables.
To type just `azee`, add `G:\A-Z_AI\AZ_AI\azee-connect\cli` to PATH
(it contains `azee.cmd` for Windows and `azee` for macOS/Linux).

```text
azee explain FILE [--lines 10-40 | --around LINE]   explain code
azee review  FILE [--lines 10-40 | --around LINE]   bugs, security risks, edge cases
azee ask "QUESTION" [FILE] [...]                     anything, optionally about code
... | azee ask "QUESTION"                            piped selection (Vim, Emacs, shell)
  --mode chat|code|research   --model auto|reasoning|code   --lang NAME   --out answer.md
```

Exit codes: `0` ok · `1` request failed · `2` usage error · `3` token problem.
Messages are limited to 20,000 characters; use `--lines` or `--around` for big files.

## 3. Editor setup

Below, `AZEE` means `G:\A-Z_AI\AZ_AI\azee-connect\cli\azee.mjs`.

### VS Code
```powershell
code --install-extension G:\A-Z_AI\AZ_AI\azee-connect\integrations\vscode\azee-connect-0.2.0.vsix
```
Run **AZee: Configure API access** (Command Palette), then select code — or nothing, for the
whole file — and use **AZee: Explain code**, **Review code for bugs**, or **Ask about this code…**
(Ctrl+Alt+A, also on the editor right-click menu). The token lives in VS Code SecretStorage.
To develop the extension: `cd azee-connect/integrations/vscode && npm install && npm run compile`, open the folder, press F5.

### Code::Blocks
**Tools → Configure tools… → Add**:

| Field | Value |
|---|---|
| Name | `AZee: Explain around cursor` |
| Executable | `node` (or the full path, e.g. `C:\Program Files\nodejs\node.exe`) |
| Parameters | `"AZEE" explain "$(ACTIVE_EDITOR_FILENAME)" --around $(ACTIVE_EDITOR_LINE)` |
| Working directory | `$(PROJECT_DIR)` |
| Launching options | **Launch tool in a new console window and wait for a keypress** |

Add a second tool with `review` instead of `explain`. Code::Blocks has no macro for the
selected text, so the tool sends 40 lines either side of the cursor (or drop `--around …`
to send the whole file). Choose **Launch tool hidden with standard output redirected** to see answers in the Code::Blocks log instead.

### Visual Studio
**Tools → External Tools… → Add**: Command `node`, Arguments
`"AZEE" explain "$(ItemPath)" --around $(CurLine)`, Initial directory `$(ItemDir)`,
tick **Use Output window**.

### JetBrains (IntelliJ, CLion, PyCharm, Rider, …)
**Settings → Tools → External Tools → +**: Program `node`, Arguments
`"AZEE" explain "$FilePath$" --lines $SelectionStartLine$-$SelectionEndLine$`,
Working directory `$ProjectFileDir$`. Assign a shortcut under **Keymap → External Tools**.

### Vim / Neovim
Select lines, then: `:'<,'>w !node AZEE ask "Explain this"` — or add a mapping:
```vim
vnoremap <leader>ae :w !node G:/A-Z_AI/AZ_AI/azee-connect/cli/azee.mjs explain --stdin<CR>
```

### Emacs
Select a region, `M-|` (shell-command-on-region), enter `node AZEE review --stdin`.

### Notepad++
**Run → Run…**: `cmd /k node "AZEE" explain "$(FULL_CURRENT_PATH)" --around $(CURRENT_LINE)` → **Save…** to name it and give it a shortcut.

### Sublime Text
**Tools → Build System → New Build System…**:
```json
{ "cmd": ["node", "G:/A-Z_AI/AZ_AI/azee-connect/cli/azee.mjs", "review", "$file"], "selector": "source" }
```

### Anything else
Any tool that can make an HTTPS request:
```bash
curl http://localhost:3000/api/v1/chat \
  -H "Authorization: Bearer az_YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"code","messages":[{"role":"user","content":"Explain: for(;;){}"}]}'
```

## Security notes
- Use HTTPS for anything but `localhost`; the clients refuse plain `http` to other hosts.
- Code you send goes to the AZ_AI server and then to its AI provider. VS Code asks before sending.
- Limits: 20 requests per minute per token; tokens expire (default 30 days) and can be revoked.
  Suspending the user's membership or tenant also blocks their tokens.
- `connect-token.cjs` needs direct database access. Never expose it as a web endpoint.
- No permissive CORS: browser pages on other origins can't call the API.
