/**
 * Blind evaluation: the evaluator sees the resume without the candidate's name
 * and contact details; the report shows the name. Masking is best effort (names
 * can appear anywhere in free text) but reliable for structured details.
 */

const NAME_WORD = /^[\p{Lu}][\p{L}'’.-]*$/u;
// Separators only when spaced ("Alex Chen - Resume"); hyphens inside names are kept ("Kealey-Brandt").
const HEADER_NOISE = /\b(resume|résumé|curriculum vitae|cv)\b|\s[-–—]\s|[:|]/gi;

/** The candidate's name from the first line of the resume, if it looks like one. */
export function nameFromText(text: string): string | null {
  const first = text
    .split("\n")
    .map((l) => l.replace(/^[#*\s]+|[*\s]+$/g, "").trim())
    .find((l) => l.length > 0);
  if (!first) return null;
  const cleaned = first.replace(HEADER_NOISE, " ").replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ");
  if (words.length < 2 || words.length > 5 || cleaned.length > 60) return null;
  if (!words.every((w) => NAME_WORD.test(w))) return null;
  return cleaned;
}

/** Fallback: a readable name from a file name like "store-manager-01-Fiona-Kealey-Brandt-cc7db9d175.md". */
export function nameFromFile(rel: string): string {
  const base = rel.split("/").pop()!.replace(/\.[^.]+$/, "");
  return base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// Australian numbers (0x / +61) and other +country numbers. Deliberately not a generic
// digit run, which would also wipe out year ranges like "2019-2025" in work history.
const PHONE = /(?:\+61|\b0)[\s-]?\d(?:[\s-]?\d){7,8}\b|\+\d{1,3}(?:[\s-]?\d){6,12}\b/g;
const URL = /\b(https?:\/\/\S+|www\.\S+|linkedin\.com\/\S+)/gi;
const DOB_LINE = /^.*\b(date of birth|DOB|born|age)\b.*$/gim;

/** Masks name, email, phone, URLs and date-of-birth lines before evaluation. */
export function maskForEvaluation(text: string, name: string | null): string {
  let t = text.replace(EMAIL, "[email]").replace(URL, "[link]").replace(PHONE, "[phone]").replace(DOB_LINE, "[personal details removed]");
  if (name) {
    for (const part of [name, ...name.split(" ").filter((w) => w.length > 2)]) {
      t = t.replace(new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), "[candidate]");
    }
  }
  return t;
}
