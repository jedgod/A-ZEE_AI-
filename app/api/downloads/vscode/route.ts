import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

// Serves the packaged AZee Connect VS Code extension (built by `npm run package` in its folder).
const VSIX = path.join(process.cwd(), "azee-connect", "integrations", "vscode", "azee-connect-0.2.0.vsix");

export async function GET() {
  try {
    const file = await readFile(VSIX);
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="azee-connect-0.2.0.vsix"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "NOT_BUILT", message: "Package the extension first: cd azee-connect/integrations/vscode && npm run package" }, { status: 404 });
  }
}
