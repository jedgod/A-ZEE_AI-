// Node module-loader hooks so the TypeScript sources run directly (node --experimental-transform-types) outside Next.js:
//   "@/x"           -> <repo>/x(.ts|.tsx|.js|/index.ts)
//   extensionless relative imports -> .ts/.tsx/.js/index.ts
//   "server-only"   -> empty module (the marker package throws outside Next's server bundle)
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = [".ts", ".tsx", ".js", ".mjs"];
function resolveFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const e of EXT) if (existsSync(base + e)) return base + e;
  for (const e of EXT) if (existsSync(path.join(base, "index" + e))) return path.join(base, "index" + e);
  return null;
}
export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const f = resolveFile(path.join(root, specifier.slice(2)));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const f = resolveFile(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  return next(specifier, context);
}
