import { ZH, ZH_PATTERNS } from "./zh";

/**
 * The UI in Chinese (owner, 2026-09-27; design: SettingsLanguage). Components stay in English; when
 * the owner picks 中文 in Settings, the rendered page's text and readable attributes are translated
 * from the dictionary (web/src/i18n/zh.ts) as React renders them. Not translated: the adviser's
 * replies (it answers in Chinese itself), what the owner typed, the job description preview, code
 * and names. Switching back to English reloads the page.
 */

export type Lang = "en" | "zh";

/** Parts of the page that are content, not UI. */
const SKIP = ".md, .bubble, textarea, input, select, code, pre, .mono, .no-i18n, .jd-preview, .recent-item .t, .hist b, .crumb b, .chg-name b, .mail-row span:last-child";
const ATTRS = ["placeholder", "aria-label", "title"];

const DAYS: Record<string, string> = { Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六", Sun: "周日" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Fri 9 Oct", "9 Oct 2026", "Mon 5 Oct 2026", "9:42 am", "September" → Chinese. */
export function zhDates(s: string): string {
  return s
    .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?: (\d{4}))?\b/g, (_, d: string, n: string, m: string, y?: string) => `${y ? `${y}年` : ""}${MONTHS.indexOf(m) + 1}月${n}日（${DAYS[d]}）`)
    .replace(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?: (\d{4}))?\b/g, (_, n: string, m: string, y?: string) => `${y ? `${y}年` : ""}${MONTHS.indexOf(m) + 1}月${n}日`)
    .replace(/\b(\d{1,2}):(\d{2}) (am|pm)\b/g, (_, h: string, mm: string, ap: string) => `${ap === "am" ? "上午" : "下午"} ${h}:${mm}`)
    .replace(/^(January|February|March|April|May|June|July|August|September|October|November|December)$/, (m) => `${FULL_MONTHS.indexOf(m) + 1}月`);
}

/** One piece of UI text in Chinese, or null when there's nothing to translate. */
export function zh(text: string): string | null {
  const key = text.replace(/\s+/g, " ").trim();
  if (!key || !/[A-Za-z]/.test(key)) return null;
  const hit = ZH[key];
  let out: string | null = hit ?? null;
  if (out === null) {
    for (const [re, to] of ZH_PATTERNS) {
      if (re.test(key)) {
        out = key.replace(re, to);
        break;
      }
    }
  }
  const dated = zhDates(out ?? key);
  if (out === null && dated === key) return null;
  // Keep the spacing around it (JSX splits sentences into several text nodes).
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const trail = /\s*$/.exec(text)?.[0] ?? "";
  return lead + dated + trail;
}

const done = new WeakMap<Node, string>();

function translateText(n: Text): void {
  const v = n.nodeValue ?? "";
  if (done.get(n) === v) return;
  const p = n.parentElement;
  if (!p || p.closest(SKIP)) return;
  const t = zh(v);
  if (t !== null && t !== v) n.nodeValue = t;
  done.set(n, n.nodeValue ?? "");
}

function translateAttrs(el: Element): void {
  if (el.closest(".md, .bubble, .no-i18n")) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const t = zh(v);
    if (t !== null && t !== v) el.setAttribute(a, t);
  }
}

function translateTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  translateAttrs(el);
  for (const e of el.querySelectorAll("[placeholder], [aria-label], [title]")) translateAttrs(e);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) translateText(n as Text);
}

let observer: MutationObserver | null = null;

/** Starts translating the page (Chinese), or stops (English: the page reloads to undo it). */
export function applyLanguage(lang: Lang): void {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  if (lang !== "zh") {
    if (observer) {
      observer.disconnect();
      observer = null;
      location.reload();
    }
    return;
  }
  if (observer) return;
  translateTree(document.body);
  observer = new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === "characterData") translateText(m.target as Text);
      else if (m.type === "attributes") translateAttrs(m.target as Element);
      else m.addedNodes.forEach(translateTree);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
