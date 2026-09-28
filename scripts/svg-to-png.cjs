// Renders SVG diagrams to PNG with Electron (offscreen, 2x), for Word documents built from docs/*.md.
// Run: SVG_IN="a.svg;b.svg" PNG_OUT=<folder> npx electron scripts/svg-to-png.cjs
// (paths go through the environment: Electron exits on an absolute-path argument.)
const { app, BrowserWindow } = require("electron");
const { readFileSync, writeFileSync, mkdirSync, rmSync } = require("node:fs");
const { basename, join } = require("node:path");
const { tmpdir } = require("node:os");

const inputs = (process.env.SVG_IN ?? "").split(";").filter(Boolean);
const out = process.env.PNG_OUT;
if (!inputs.length || !out) {
  console.error("SVG_IN and PNG_OUT are required");
  process.exit(2);
}
app.disableHardwareAcceleration();
// One window per diagram: closing it must not end the app before the next one.
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  mkdirSync(out, { recursive: true });
  for (const file of inputs) {
    const svg = readFileSync(file, "utf8");
    const w = Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)?.[1] ?? 1200);
    const h = Number(/<svg[^>]*\sheight="(\d+)"/.exec(svg)?.[1] ?? 800);
    const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { offscreen: true, zoomFactor: 2 } });
    win.webContents.setZoomFactor(2);
    // A file per diagram (a second data: URL load was aborted).
    const page = join(tmpdir(), `svg-to-png-${process.pid}-${basename(file)}.html`);
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`);
    await win.loadFile(page);
    rmSync(page, { force: true });
    win.setContentSize(w * 2, h * 2);
    await new Promise((r) => setTimeout(r, 400));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: w * 2, height: h * 2 });
    const target = join(out, basename(file).replace(/\.svg$/, ".png"));
    writeFileSync(target, img.toPNG());
    console.log(`${target} ${w}x${h}`);
    win.destroy();
  }
  app.quit();
});
