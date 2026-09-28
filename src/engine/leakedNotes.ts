/**
 * Client-side backstop for replies that end with the model's own planning notes (round 6 evaluation,
 * rec-06: "…all backgrounds. Rescue wording? We should mention … But deliverable first, then note. Also
 * perhaps … Need maybe user asked ad; concise."). 1 of about 1,340 stored replies; none of the others
 * matched two of these markers. Only the end of a reply is checked, and only removed when at least two
 * different markers appear there, so a letter's "We should" alone is kept.
 */

// Notes about writing the reply, not words written to the owner.
const MARKERS: RegExp[] = [
  /\bthe user (asked|wants|said|is asking|might|mentioned|needs)\b/i,
  /\bWe should (mention|add|include|note|say|ask)\b/,
  /\bNeed (to )?(maybe|mention|add|include|ask)\b/,
  /\bdeliverable first\b/i,
  /\bthen note\b/i,
  /\bAlso perhaps\b/,
  /\bI should (mention|add|include|note|ask)\b/,
  /\bmaybe mention\b/i,
  /\bLet me (draft|write|think)\b/,
];

const hits = (s: string) => MARKERS.filter((m) => m.test(s)).length;

/**
 * The reply without trailing planning notes, and what was removed (null if nothing). Looks at the last
 * paragraph: from the first sentence with a marker to the end, when that part has two or more markers;
 * a short question just before it ("Rescue wording?") goes with it.
 */
export function stripLeakedNotes(text: string): { text: string; removed: string | null } {
  const body = text.replace(/\s+$/, "");
  const cut = body.lastIndexOf("\n\n");
  const para = body.slice(cut + 1);
  // Sentences with their offsets in the paragraph.
  const sentences = [...para.matchAll(/[^.?!\n]+[.?!]*\s*/g)].map((m) => ({ s: m[0], at: m.index ?? 0 }));
  let i = sentences.findIndex((x) => hits(x.s) > 0);
  if (i < 0 || hits(para.slice(sentences[i].at)) < 2) return { text, removed: null };
  while (i > 0 && /^\s*[^.?!\n]{1,30}\?\s*$/.test(sentences[i - 1].s) && sentences[i - 1].s.trim().split(/\s+/).length <= 3) i--;
  const from = cut + 1 + sentences[i].at;
  const kept = body.slice(0, from).replace(/\s+$/, "");
  if (!kept) return { text, removed: null };
  return { text: kept, removed: body.slice(from).trim() };
}
