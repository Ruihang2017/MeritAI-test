import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * How replies are formatted. "plain": the terminal shows raw text (prompts/base.md as it is).
 * "markdown": a chat UI renders GitHub-flavoured markdown.
 */
export type ReplyFormat = "plain" | "markdown";

/**
 * The lines of prompts/base.md that assume a raw-text terminal, and what replaces them
 * for a markdown UI. base.md itself stays the plain version, so the CLI and the
 * evaluation get exactly the same prompt as before.
 */
export const MARKDOWN_SWAPS: [plain: string, markdown: string][] = [
  ["through a plain-text chat window in a terminal", "through a chat window"],
  [
    '- The chat window shows raw text, so keep formatting light: short paragraphs, simple "-" bullet lists or numbered lists when they help. No tables, no headings, no bold or italics, no code blocks unless the user asks for code.',
    '- The chat window renders GitHub-flavoured markdown. Use it where it helps the reader: short paragraphs, "-" bullet lists, numbered lists for steps, **bold** for the one thing not to miss (a deadline, a must-do), "###" headings only to separate the parts of a longer answer, and [text](url) links for URLs a tool returned. A small table only when comparing a few options side by side. No code blocks unless the user asks for code.',
  ],
];

/** The base instructions (replacing Codex's coding-agent prompt) for a reply format. */
export function basePrompt(root: string, format: ReplyFormat = "plain"): string {
  const text = readFileSync(resolve(root, "prompts/base.md"), "utf8");
  if (format === "plain") return text;
  return MARKDOWN_SWAPS.reduce((out, [plain, markdown]) => {
    // Fail loudly if base.md was edited, rather than sending a prompt with both rules.
    if (!out.includes(plain)) throw new Error(`prompts/base.md changed: update MARKDOWN_SWAPS in src/basePrompt.ts ("${plain.slice(0, 50)}..." not found)`);
    return out.replace(plain, markdown);
  }, text);
}
