/**
 * Email drafts as .eml files (owner, 2026-09-27): MeritAI drafts, the owner's email app sends.
 * The file is marked unsent (X-Unsent: 1), so Outlook opens it as a new message ready to check
 * and send, with the attachments. Nothing here sends anything: sending from Gmail is src/email/
 * (the owner presses Send; `forSending` makes the message it sends).
 */

export interface EmailDraft {
  to: string[];
  cc: string[];
  subject: string;
  /** Plain text. */
  body: string;
  attachments: { name: string; data: Buffer }[];
}

/** One address, as people write them (no display names, no lists). */
export const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[a-z]{2,}$/i;

const b64lines = (buf: Buffer) => (buf.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);
/** A header value: as is when plain ASCII, else an RFC 2047 encoded word. */
const word = (s: string) => (ascii(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

const MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".json": "application/json",
};
const mimeOf = (name: string) => MIME[/\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? ""] ?? "application/octet-stream";

export function buildEml(d: EmailDraft, boundary = `meritai-${Date.now().toString(36)}`): string {
  const head = [
    ...(d.to.length ? [`To: ${d.to.join(", ")}`] : []),
    ...(d.cc.length ? [`Cc: ${d.cc.join(", ")}`] : []),
    `Subject: ${word(clean(d.subject))}`,
    "X-Unsent: 1",
    "X-Mailer: MeritAI (draft, not sent)",
    "MIME-Version: 1.0",
  ];
  const text = ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", b64lines(Buffer.from(d.body.replace(/\r?\n/g, "\r\n"), "utf8"))].join("\r\n");
  if (!d.attachments.length) return [...head, text].join("\r\n") + "\r\n";
  const parts = [
    text,
    ...d.attachments.map((a) => {
      const n = word(clean(a.name)).replace(/"/g, "'");
      return [`Content-Type: ${mimeOf(a.name)}; name="${n}"`, `Content-Disposition: attachment; filename="${n}"`, "Content-Transfer-Encoding: base64", "", b64lines(a.data)].join("\r\n");
    }),
  ];
  return [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts.map((p) => `--${boundary}\r\n${p}`), `--${boundary}--`, ""].join("\r\n");
}

export const unword = (s: string) => s.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b: string) => Buffer.from(b, "base64").toString("utf8"));

/** A draft this app wrote, in full (for editing it or sending it): the reverse of buildEml. */
export function parseEml(text: string): EmailDraft {
  const cut = text.search(/\r?\n\r?\n/);
  const head = cut < 0 ? text : text.slice(0, cut);
  const header = (k: string, h = head) => new RegExp(`^${k}: (.*)$`, "mi").exec(h)?.[1]?.trim() ?? "";
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const b64 = (s: string) => Buffer.from(s.replace(/\s+/g, ""), "base64");
  const boundary = /boundary="([^"]+)"/.exec(header("Content-Type"))?.[1];
  let body = "";
  const attachments: EmailDraft["attachments"] = [];
  const parts = boundary ? text.split(`--${boundary}`).slice(1, -1) : [text.slice(cut)];
  for (const raw of parts) {
    const p = raw.replace(/^\r?\n/, "");
    const at = p.search(/\r?\n\r?\n/);
    const ph = boundary ? p.slice(0, at) : head;
    const data = (boundary ? p.slice(at) : p).trim();
    const name = /filename="([^"]+)"/.exec(ph)?.[1];
    if (name) attachments.push({ name: unword(name), data: b64(data) });
    else if (/text\/plain/i.test(ph) && !body) body = b64(data).toString("utf8").replace(/\r\n/g, "\n");
  }
  return { to: list(header("To")), cc: list(header("Cc")), subject: unword(header("Subject")), body, attachments };
}

/** The email addresses written in a text (an application), lower-cased, first seen first. */
export function emailsIn(text: string): string[] {
  const found = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? []).map((x) => x.toLowerCase());
  return [...new Set(found)].filter((x) => EMAIL_RE.test(x));
}

/**
 * A draft made ready to send: the draft markers dropped, the recipient the owner saw, and in test
 * mode the owner's own address with the real recipient in the subject ("[Test → …]") and no Cc.
 */
export function forSending(d: EmailDraft, to: string, test: { self: string } | null): Buffer {
  const out = test ? { ...d, to: [test.self], cc: [], subject: `[Test → ${to}] ${d.subject}` } : { ...d, to: [to] };
  return Buffer.from(
    buildEml(out)
      .replace(/^X-Unsent: 1\r\n/m, "")
      .replace(/^X-Mailer: .*\r\n/m, "X-Mailer: MeritAI\r\n"),
    "utf8",
  );
}

/** What a UI shows of a draft this app wrote: recipients, subject, attachment names, the start of the text. */
export function readEml(text: string): { to: string[]; cc: string[]; subject: string; attachments: string[]; preview: string } {
  const [headPart] = text.split(/\r?\n\r?\n/);
  const header = (k: string) => new RegExp(`^${k}: (.*)$`, "mi").exec(headPart)?.[1]?.trim() ?? "";
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const attachments = [...text.matchAll(/Content-Disposition: attachment; filename="([^"]+)"/g)].map((m) => unword(m[1]));
  const body = /Content-Type: text\/plain; charset=utf-8\r?\nContent-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/.exec(text)?.[1] ?? "";
  const plain = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  return { to: list(header("To")), cc: list(header("Cc")), subject: unword(header("Subject")), attachments, preview: plain.replace(/\s+/g, " ").trim().slice(0, 220) };
}
