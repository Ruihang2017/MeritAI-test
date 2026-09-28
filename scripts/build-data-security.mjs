// Builds release/MeritAI data and security.docx from docs/data-and-security.md, with its diagrams
// (docs/images/*.svg rendered to PNG by Electron: scripts/svg-to-png.cjs). Run with tsx.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { markdownToDocx } from "../src/files/docx.ts";

const md = readFileSync("docs/data-and-security.md", "utf8");
const svgs = [...md.matchAll(/!\[[^\]]*\]\((images\/[^)]+\.svg)\)/g)].map((m) => resolve("docs", m[1]));
const png = mkdtempSync(join(tmpdir(), "meritai-diagrams-"));
const r = spawnSync(process.execPath, [resolve("node_modules/electron/cli.js"), "scripts/svg-to-png.cjs"], {
  env: { ...process.env, SVG_IN: svgs.join(";"), PNG_OUT: png },
  stdio: "inherit",
});
if (r.status !== 0) throw new Error(`rendering the diagrams failed (${r.status})`);

// Page width in Word is about 6.3 inches: 600 px at 96 dpi; the height keeps the SVG's proportions.
const images = (src) => {
  const file = resolve("docs", src);
  const svg = readFileSync(file, "utf8");
  const w = Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)?.[1]);
  const h = Number(/<svg[^>]*\sheight="(\d+)"/.exec(svg)?.[1]);
  return { data: readFileSync(join(png, basename(file).replace(/\.svg$/, ".png"))), width: 600, height: Math.round((600 * h) / w) };
};
mkdirSync("release", { recursive: true });
const out = "release/MeritAI data and security.docx";
writeFileSync(out, await markdownToDocx(md, "MeritAI: data and security", { images }));
rmSync(png, { recursive: true, force: true });
console.log(out);
