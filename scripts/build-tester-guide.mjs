// Builds release/MeritAI alpha tester guide.docx from docs/alpha/tester-guide.md with the app's own
// markdown-to-Word converter (src/files/docx.ts). Run with tsx (it imports TypeScript).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { markdownToDocx } from "../src/files/docx.ts";

const md = readFileSync("docs/alpha/tester-guide.md", "utf8");
mkdirSync("release", { recursive: true });
const out = "release/MeritAI alpha tester guide.docx";
writeFileSync(out, await markdownToDocx(md, "MeritAI alpha: tester guide"));
console.log(out);
