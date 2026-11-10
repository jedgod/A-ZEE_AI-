// Regenerates the app icon, adaptive icon layers, splash and favicon (a simple "a" mark in the
// A-Zee green). Replace the PNGs in assets/ with your final artwork any time; this just gives the
// project valid, correctly sized placeholders. Run: node scripts/make-assets.cjs
// (uses the "sharp" package from the web app's node_modules).
const path = require("node:path");
const fs = require("node:fs");
const sharp = require(path.join(__dirname, "..", "..", "node_modules", "sharp"));

const out = path.join(__dirname, "..", "assets");
fs.mkdirSync(out, { recursive: true });

const GREEN = "#047857", DARK = "#06281d", WHITE = "#ffffff";
// The "a" glyph is drawn as shapes, not text, so it renders the same without any installed font.
const mark = (fill, scale = 1) => `
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
    <circle cx="500" cy="528" r="190" fill="none" stroke="${fill}" stroke-width="86"/>
    <rect x="636" y="338" width="86" height="380" rx="43" fill="${fill}"/>
  </g>`;
const svg = (inner, bg) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ""}${inner}</svg>`);

async function png(name, buffer, size = 1024) {
  await sharp(buffer).resize(size, size).png().toFile(path.join(out, name));
  console.log("wrote", name, `${size}x${size}`);
}

(async () => {
  await png("icon.png", svg(mark(WHITE), GREEN));                                  // iOS / store icon: opaque, square
  await png("android-icon-foreground.png", svg(mark(WHITE, 0.62)));                // keeps the glyph inside Android's safe zone
  await png("android-icon-background.png", svg("", GREEN));
  await png("android-icon-monochrome.png", svg(mark("#000000", 0.62)));
  await png("splash-icon.png", svg(mark(GREEN, 0.8)));
  await png("favicon.png", svg(mark(WHITE), GREEN), 48);
  console.log("done");
})().catch(e => { console.error(e.message); process.exit(1); });
