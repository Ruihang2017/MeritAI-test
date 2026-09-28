// A release's notes for the update popup (src/desktop/updates.ts), without Electron so tests can use it.

/** A release's notes (HTML or text, or one entry per release) as a few plain lines. */
export function notesOf(notes: unknown): string[] {
  const text = Array.isArray(notes) ? notes.map((n) => (n as { note?: string | null }).note ?? "").join("\n") : typeof notes === "string" ? notes : "";
  return text
    .replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|#+)\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}
