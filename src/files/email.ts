/**
 * Email drafts as .eml files (owner, 2026-09-27): MeritAI drafts, the owner's email app sends.
 * The file is marked unsent (X-Unsent: 1), so Outlook opens it as a new message ready to check
 * and send, with the attachments. Nothing here sends anything; no account is connected.
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

const unword = (s: string) => s.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b: string) => Buffer.from(b, "base64").toString("utf8"));

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
