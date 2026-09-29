import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { Api } from "../api";
import type { JobJd } from "../../../src/server/protocol";
import { Icon } from "./Icon";

/**
 * The job description on the Hiring page (owner, 2026-09-29; design: HiringJDOpen, HiringJD, HiringJDEdit,
 * HiringJDChanged): open while the criteria aren't confirmed, closed after (the owner can toggle it);
 * edited in place (headings, paragraphs, bullet points, bold) and saved as the job's Word file, with Undo;
 * a notice when the criteria came from another version.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

/** Markdown → the few elements the card shows and edits. Everything is escaped first. */
export function mdToHtml(md: string): string {
  const out: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (list) out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join("")}</ul>`);
    list = null;
  };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      (list ??= []).push(inline(bullet[1]));
      continue;
    }
    flush();
    if (!line) continue;
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) out.push(`<h${Math.min(h[1].length, 3)}>${inline(h[2])}</h${Math.min(h[1].length, 3)}>`);
    else out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join("");
}

/** The edited element → markdown (headings, paragraphs, bullets, bold); anything else becomes its text. */
export function htmlToMd(root: HTMLElement): string {
  const text = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? "").replace(/\s+/g, " ");
    if (!(n instanceof HTMLElement)) return "";
    if (n.tagName === "BR") return " ";
    const inner = [...n.childNodes].map(text).join("");
    return (n.tagName === "STRONG" || n.tagName === "B") && inner.trim() ? `**${inner.trim()}**` : inner;
  };
  const blocks: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = text(n).trim();
      if (t) blocks.push(t);
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    const tag = n.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const t = text(n).trim();
      if (t) blocks.push(`${"#".repeat(Math.min(Number(tag[1]), 3))} ${t}`);
    } else if (tag === "UL" || tag === "OL") {
      const items = [...n.children].filter((c) => c.tagName === "LI").map((li) => text(li).trim()).filter(Boolean);
      if (items.length) blocks.push(items.map((i) => `- ${i}`).join("\n"));
    } else if (tag === "P" || tag === "LI") {
      const t = text(n).trim();
      if (t) blocks.push(t);
    } else if ([...n.children].some((c) => /^(P|DIV|H[1-6]|UL|OL)$/.test(c.tagName))) {
      n.childNodes.forEach(walk);
    } else {
      const t = text(n).trim();
      if (t) blocks.push(t);
    }
  };
  root.childNodes.forEach(walk);
  return blocks.join("\n\n").trim();
}

function toBase64(f: File): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => fail(new Error(`Couldn't read ${f.name}`));
    r.readAsDataURL(f);
  });
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

export function JobDescriptionCard(p: {
  api: Api;
  job: string;
  closed: boolean;
  /** Open by default until the criteria are confirmed. */
  defaultOpen: boolean;
  /** Anything that means the job may have changed (the page's latest results). */
  version: unknown;
  onReviewCriteria: () => void;
  onAsk: (text: string, draft?: boolean) => void;
  onChanged: () => void;
}) {
  const [jd, setJd] = useState<JobJd | null | undefined>(undefined);
  const [open, setOpen] = useState(p.defaultOpen);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const upload = useRef<HTMLInputElement>(null);

  useEffect(() => setOpen(p.defaultOpen), [p.job, p.defaultOpen]);
  useEffect(() => {
    setEditing(false);
    setSaved(null);
    setErr(null);
  }, [p.job]);
  useEffect(() => {
    let live = true;
    p.api.call("jobJd", { job: p.job }).then((r) => live && setJd(r), (e: Error) => live && (setJd(null), setErr(e.message)));
    return () => {
      live = false;
    };
  }, [p.api, p.job, p.version]);

  if (jd === undefined || jd === null) return null;
  const act = async (label: string, f: () => Promise<JobJd>, receipt: string | null) => {
    setBusy(label);
    setErr(null);
    try {
      const r = await f();
      setJd(r);
      setSaved(receipt);
      setEditing(false);
      p.onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const save = () => {
    const md = editor.current ? htmlToMd(editor.current) : "";
    if (!md) return setErr("The job description is empty.");
    const was = jd.format;
    void act("Saving", () => p.api.call("saveJobJd", { job: p.job, markdown: md }), was === "docx" ? `Saved: ${jd.file}.` : `Saved as a Word file. The ${was.toUpperCase()} is kept as the previous version.`);
  };
  const format = (cmd: "bold" | "list" | "heading") => {
    editor.current?.focus();
    if (cmd === "bold") document.execCommand("bold");
    else if (cmd === "list") document.execCommand("insertUnorderedList");
    else {
      const block = document.queryCommandValue("formatBlock").toLowerCase();
      document.execCommand("formatBlock", false, /^h[1-6]$/.test(block) ? "p" : "h2");
    }
  };
  const stale = jd.criteriaStale;
  return (
    <section className="card jd-card" aria-label="Job description">
      <div className="jd-head">
        <Icon name="file" size={18} />
        <div className="grow" style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <h3 className="h3">Job description</h3>
          <span className="meta">
            <span className="mono">{jd.file}</span> · updated {when(jd.updatedAt)}
          </span>
        </div>
        {editing ? (
          <span className="pill info">Editing</span>
        ) : (
          !p.closed && (
            <>
              <button type="button" className="btn sm" disabled={!!busy} onClick={() => (setEditing(true), setOpen(true), setSaved(null))}>
                <Icon name="edit" size={15} />
                Edit
              </button>
              <button type="button" className="btn sm g" onClick={() => p.onAsk(`Change the job description of "${p.job}": `, true)}>
                Ask MeritAI to change it
              </button>
            </>
          )
        )}
        {!editing && (
          <div style={{ position: "relative" }}>
            <button type="button" className="ib" aria-label="More: open in Word, replace the file, show in folder" aria-haspopup="menu" aria-expanded={menu} style={{ width: 36, height: 36 }} onClick={() => setMenu(!menu)}>
              <Icon name="more" size={18} />
            </button>
            {menu && (
              <>
                <div className="fill" style={{ zIndex: 29 }} onClick={() => setMenu(false)} />
                <div className="menu jd-menu" role="menu" aria-label="Job description">
                  <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(false), void p.api.call("openFile", { path: jd.path }))}>
                    Open in Word
                  </button>
                  {!p.closed && (
                    <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(false), upload.current?.click())}>
                      Replace the file
                    </button>
                  )}
                  <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(false), void p.api.call("revealFile", { path: jd.path }))}>
                    Show in folder
                  </button>
                  {!p.closed && jd.canUndo && (
                    <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(false), void act("Restoring", () => p.api.call("undoJobJd", { job: p.job }), "Restored the previous version."))}>
                      Undo last save
                    </button>
                  )}
                </div>
              </>
            )}
            <input
              ref={upload}
              type="file"
              hidden
              accept=".docx,.pdf,.txt,.md"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void act("Replacing", async () => p.api.call("replaceJobJd", { job: p.job, file: { name: f.name, base64: await toBase64(f) } }), `Replaced with ${f.name}. The earlier file is kept (Undo).`);
              }}
            />
          </div>
        )}
      </div>

      {err && (
        <div className="banner bad" role="alert" style={{ margin: "12px 16px 0" }}>
          <span className="grow">{err}</span>
        </div>
      )}
      {saved && !editing && (
        <div className="receipt" style={{ margin: "12px 16px 0" }}>
          <Icon name="check" size={16} stroke={2.4} />
          <span className="grow">{saved}</span>
          {jd.canUndo && (
            <button type="button" className="btn g sm" disabled={!!busy} onClick={() => void act("Restoring", () => p.api.call("undoJobJd", { job: p.job }), "Restored the previous version.")}>
              Undo
            </button>
          )}
        </div>
      )}

      {editing ? (
        <>
          <div className="jd-toolbar" role="toolbar" aria-label="Formatting">
            <button type="button" className="ib" aria-label="Heading" onMouseDown={(e) => (e.preventDefault(), format("heading"))}>
              <b>H</b>
            </button>
            <button type="button" className="ib" aria-label="Bold" onMouseDown={(e) => (e.preventDefault(), format("bold"))}>
              <b style={{ fontWeight: 800 }}>B</b>
            </button>
            <button type="button" className="ib" aria-label="Bulleted list" onMouseDown={(e) => (e.preventDefault(), format("list"))}>
              <Icon name="list" size={18} />
            </button>
            <span className="meta">Headings, paragraphs, bullet points and bold. Enter in a list adds a point.</span>
          </div>
          <div
            ref={editor}
            className="jd-body jd-edit"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Job description, editable"
            dangerouslySetInnerHTML={{ __html: mdToHtml(jd.markdown) }}
            onPaste={(e) => {
              e.preventDefault();
              document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
            }}
          />
          {jd.format !== "docx" && (
            <div className="banner info" style={{ margin: "10px 16px 0", fontSize: 13 }}>
              <span>
                This is a {jd.format.toUpperCase()}. Saving makes <span className="mono">{p.job} JD.docx</span> in simple formatting; the {jd.format.toUpperCase()} is kept as the previous version, and <b>Undo</b> brings it back.
              </span>
            </div>
          )}
          {jd.format === "docx" && (
            <div className="banner info" style={{ margin: "10px 16px 0", fontSize: 13 }}>
              <span>Saving rewrites the Word file in simple formatting (headings, lists, bold). The current version is kept, and <b>Undo</b> brings it back.</span>
            </div>
          )}
          <div className="jd-actions">
            <button type="button" className="btn p" disabled={!!busy} onClick={save}>
              {busy === "Saving" ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => (setEditing(false), setErr(null))}>
              Cancel
            </button>
            <span className="meta grow">Only you change it here: no MeritAI, nothing to confirm. If it's open in Word, close it there first.</span>
          </div>
        </>
      ) : (
        <>
          <div className={`jd-body${open ? "" : " jd-closed"}`} dangerouslySetInnerHTML={{ __html: mdToHtml(jd.markdown) }} />
          <div className="jd-toggle">
            <button type="button" className="btn g sm" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Show less" : "Show all"}
              <Icon name={open ? "up" : "down"} size={14} stroke={2} />
            </button>
          </div>
        </>
      )}

      {stale && !editing && (
        <div className="banner warn jd-stale">
          <span className="grow">
            {jd.criteriaConfirmedAt ? (
              <>
                <b>The job description changed after you confirmed the criteria</b> ({when(jd.criteriaConfirmedAt)}). The criteria were drafted from the earlier version: check they still fit before screening.
              </>
            ) : (
              <>
                <b>The criteria were drafted from an earlier version of the job description.</b> Draft them again, or keep them if they still fit.
              </>
            )}
          </span>
          {!p.closed && (
            <>
              <button type="button" className="btn sm" onClick={p.onReviewCriteria}>
                {jd.criteriaConfirmedAt ? "Review criteria" : "Draft them again"}
              </button>
              <button type="button" className="btn g sm" onClick={() => void p.api.call("keepCriteria", { job: p.job }).then(() => (setJd({ ...jd, criteriaStale: false }), p.onChanged()), (e: Error) => setErr(e.message))}>
                They still fit
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
