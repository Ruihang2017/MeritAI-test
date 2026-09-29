import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { candidates } from "../business/hiring";
import { buildEml, EMAIL_RE, emailsIn, forSending, parseEml } from "../files/email";
import { resolveInside, type Folders } from "../files/folders";
import type { Catalog, Decision, EmailKind, EmailRecord } from "../screening/catalog";
import type { GmailSender } from "./gmail";

/**
 * The emails MeritAI drafted, to review and send from Gmail (design: EmailReview, EmailOne,
 * EmailSent). The adviser drafts into the Outbox; the owner sends. Addresses for a candidate come
 * from their application, found by code and shown before sending: none found, the owner types
 * one; several, the owner picks. Sending waits 10 seconds (Undo, Send now); a candidate already
 * sent this kind of email is sent it again only when the owner says so.
 */

export const SEND_DELAY_MS = 10_000;

export interface EmailItem {
  /** The draft's file name in the Outbox, and its path. */
  draft: string;
  path: string;
  job: string | null;
  candidate: { file: string; name: string; decision: Decision | null } | null;
  kind: EmailKind;
  /** The draft's own recipients (the adviser's). */
  to: string[];
  subject: string;
  body: string;
  attachments: string[];
  /** Where to send it: from the candidate's application and the draft. */
  options: { address: string; from: "application" | "draft" | "both" }[];
  sentAt: string | null;
  sentTo: string | null;
  test: boolean;
  /** Another draft of the same kind was already sent to this candidate. */
  earlier: { at: string; to: string | null } | null;
}

const KIND_ORDER: Record<EmailKind, number> = { invite: 0, not: 1, other: 2 };

function item(folders: Folders, cat: Catalog, r: EmailRecord, all: EmailRecord[], who: Map<string, { file: string; name: string; decision: Decision | null }>): EmailItem | null {
  const path = join(folders.outbox, r.draft);
  if (!existsSync(path)) return null;
  const d = parseEml(readFileSync(path, "utf8"));
  const fromApp = r.hash ? emailsIn(cat.getText(r.hash)?.text ?? "") : [];
  const fromDraft = d.to.map((x) => x.toLowerCase());
  const options = [...new Set([...fromDraft, ...fromApp])].map((address) => ({
    address,
    from: fromApp.includes(address) && fromDraft.includes(address) ? ("both" as const) : fromApp.includes(address) ? ("application" as const) : ("draft" as const),
  }));
  const earlierRec = r.hash
    ? all.filter((x) => x.draft !== r.draft && x.hash === r.hash && x.job === r.job && x.kind === r.kind && x.sentAt).sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))[0]
    : undefined;
  return {
    draft: r.draft,
    path,
    job: r.job,
    candidate: r.hash ? (who.get(r.hash) ?? null) : null,
    kind: r.kind,
    to: d.to,
    subject: d.subject,
    body: d.body,
    attachments: d.attachments.map((a) => a.name),
    options,
    sentAt: r.sentAt,
    sentTo: r.sentTo,
    test: r.test,
    earlier: earlierRec ? { at: earlierRec.sentAt!, to: earlierRec.sentTo } : null,
  };
}

/**
 * A job's candidate emails still in the Outbox: invitations, then "not this time", then others,
 * by name. Of several unsent drafts of one kind for one candidate, only the newest is listed.
 */
export function jobEmails(folders: Folders, cat: Catalog, job: string): EmailItem[] {
  const all = cat.emails(job);
  const who = new Map(candidates(cat, job).map((c) => [c.hash, { file: c.file, name: c.name, decision: c.decision }]));
  const newest = new Map<string, EmailRecord>();
  for (const r of all.filter((x) => !x.sentAt && x.hash)) {
    const k = `${r.hash}:${r.kind}`;
    if (!newest.has(k) || newest.get(k)!.createdAt < r.createdAt) newest.set(k, r);
  }
  const listed = all.filter((r) => r.hash && (r.sentAt || newest.get(`${r.hash}:${r.kind}`) === r));
  return listed
    .flatMap((r) => item(folders, cat, r, all, who) ?? [])
    .filter((x) => x.candidate)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.candidate!.name.localeCompare(b.candidate!.name));
}

/** One draft of the Outbox (an email card in the chat), linked to a candidate or not. */
export function emailItem(folders: Folders, cat: Catalog, draft: string): EmailItem | null {
  resolveInside(folders.outbox, draft);
  const r = cat.email(draft) ?? { draft, job: null, hash: null, kind: "other" as const, createdAt: "", sentAt: null, sentTo: null, test: false };
  const all = r.job ? cat.emails(r.job) : [];
  const who = r.job ? new Map(candidates(cat, r.job).map((c) => [c.hash, { file: c.file, name: c.name, decision: c.decision }])) : new Map();
  return item(folders, cat, r, all, who);
}

/** The owner's edit of a draft before sending: its subject and text (the recipients and attachments stay). */
export function updateDraft(folders: Folders, draft: string, change: { subject: string; body: string }): void {
  const path = resolveInside(folders.outbox, draft);
  if (!/\.eml$/i.test(draft)) throw new Error("not an email draft");
  const subject = change.subject.trim();
  const body = change.body.trim();
  if (!subject || !body) throw new Error("the email needs a subject and a message");
  if (body.length > 50_000) throw new Error("the message is too long");
  const d = parseEml(readFileSync(path, "utf8"));
  writeFileSync(path, buildEml({ ...d, subject, body: body + "\n" }));
}

export interface SendRequest {
  draft: string;
  to: string;
}

export interface SendResult {
  draft: string;
  ok: boolean;
  to: string;
  error?: string;
}

/**
 * Checks a request to send before it waits: Gmail connected, each draft an unsent .eml in the
 * Outbox, one valid address each, nothing sent twice unless `again`. Returns the problems.
 */
export function checkSend(folders: Folders, cat: Catalog, reqs: SendRequest[], opts: { connected: boolean; again: boolean }): string[] {
  if (!opts.connected) return ["Gmail isn't connected: connect it in Connections first."];
  if (!reqs.length) return ["Nothing to send."];
  if (reqs.length > 100) return ["Send at most 100 emails at a time."];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of reqs) {
    if (seen.has(r.draft)) problems.push(`"${r.draft}" is in the list twice.`);
    seen.add(r.draft);
    let path: string;
    try {
      path = resolveInside(folders.outbox, r.draft);
    } catch {
      problems.push(`"${r.draft}" isn't in the Outbox.`);
      continue;
    }
    if (!/\.eml$/i.test(r.draft) || !existsSync(path)) problems.push(`"${r.draft}" isn't an email draft in the Outbox.`);
    if (!EMAIL_RE.test(r.to.trim())) problems.push(`"${r.to}" isn't an email address.`);
    const rec = cat.email(r.draft);
    if (rec?.sentAt) problems.push(`"${r.draft}" was already sent.`);
    else if (rec?.hash && !opts.again && cat.emails(rec.job ?? undefined).some((x) => x.draft !== r.draft && x.hash === rec.hash && x.kind === rec.kind && x.sentAt)) {
      problems.push(`${r.draft}: this candidate was already sent this kind of email.`);
    }
  }
  return problems;
}

interface Batch {
  reqs: SendRequest[];
  sendAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  state: "waiting" | "sending" | "done" | "cancelled";
  results: Promise<SendResult[]>;
  resolve: (r: SendResult[]) => void;
}

/**
 * Emails waiting their 10 seconds, then sent one by one from Gmail. Undo stops a batch that
 * hasn't started; Send now starts it at once. A batch still waiting when MeritAI closes isn't sent.
 */
export class SendQueue {
  private batches = new Map<string, Batch>();
  private next = 1;

  constructor(
    private readonly deps: {
      sender: () => GmailSender;
      folders: () => Folders;
      catalog: () => Catalog;
      /** Test mode: the owner's own address; null sends to the real recipients. */
      testSelf: () => string | null;
      /** An email for no candidate was sent (the app reports it as a change to the file). */
      onSent?: (path: string, to: string, test: boolean) => void;
    },
  ) {}

  queue(reqs: SendRequest[], delayMs = SEND_DELAY_MS): { id: string; sendAt: string; count: number } {
    const id = `send-${this.next++}`;
    let resolve!: (r: SendResult[]) => void;
    const results = new Promise<SendResult[]>((r) => (resolve = r));
    const b: Batch = { reqs, sendAt: Date.now() + delayMs, timer: null, state: "waiting", results, resolve };
    b.timer = setTimeout(() => this.start(b), delayMs);
    this.batches.set(id, b);
    return { id, sendAt: new Date(b.sendAt).toISOString(), count: reqs.length };
  }

  private start(b: Batch): void {
    if (b.state !== "waiting") return;
    if (b.timer) clearTimeout(b.timer);
    b.state = "sending";
    void this.sendAll(b.reqs).then((r) => {
      b.state = "done";
      b.resolve(r);
    });
  }

  /** Undo: true if the batch hadn't started (nothing was sent). */
  cancel(id: string): boolean {
    const b = this.batches.get(id);
    if (!b || b.state !== "waiting") return false;
    if (b.timer) clearTimeout(b.timer);
    b.state = "cancelled";
    b.resolve([]);
    return true;
  }

  sendNow(id: string): boolean {
    const b = this.batches.get(id);
    if (!b || b.state !== "waiting") return false;
    this.start(b);
    return true;
  }

  /** The batch's results once sent ([] if it was cancelled). */
  async results(id: string): Promise<{ state: Batch["state"]; results: SendResult[] }> {
    const b = this.batches.get(id);
    if (!b) throw new Error("no such send");
    const results = await b.results;
    return { state: b.state, results };
  }

  /** Stops every waiting batch (MeritAI closing): they aren't sent. */
  cancelAll(): number {
    return [...this.batches.keys()].filter((id) => this.cancel(id)).length;
  }

  private async sendAll(reqs: SendRequest[]): Promise<SendResult[]> {
    const out: SendResult[] = [];
    const self = this.deps.testSelf();
    for (const r of reqs) {
      const to = r.to.trim();
      try {
        const path = resolveInside(this.deps.folders().outbox, r.draft);
        const cat = this.deps.catalog();
        if (cat.email(r.draft)?.sentAt) throw new Error("already sent");
        const mime = forSending(parseEml(readFileSync(path, "utf8")), to, self ? { self } : null);
        const messageId = await this.deps.sender().send(mime);
        cat.markEmailSent(r.draft, { to, test: !!self, messageId });
        if (!cat.email(r.draft)?.hash) this.deps.onSent?.(path, to, !!self);
        out.push({ draft: r.draft, ok: true, to });
      } catch (e) {
        out.push({ draft: r.draft, ok: false, to, error: (e as Error).message });
      }
    }
    return out;
  }
}
