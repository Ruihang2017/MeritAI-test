import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { marked, type Token, type Tokens } from "marked";

/**
 * Markdown → .docx for documents the assistant saves. Supports what our
 * outputs use: headings, paragraphs, bold/italic/code, bullet and numbered
 * lists (nested), tables, block quotes, code blocks and rules. A paragraph that is only an image
 * (`![caption](file.png)`) becomes the picture with its caption, but only when the caller passes
 * `images` (our own docs builds); documents the assistant saves never embed files.
 */

/** A PNG for an image path, with its size in the document (px at 96 dpi), or null to keep the text. */
export type ImageSource = (src: string) => { data: Buffer; width: number; height: number } | null;

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  code?: boolean;
}

function inlineRuns(tokens: Token[] | undefined, style: RunStyle = {}): TextRun[] {
  const out: TextRun[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong":
        out.push(...inlineRuns((t as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...inlineRuns((t as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case "codespan":
        out.push(run((t as Tokens.Codespan).text, { ...style, code: true }));
        break;
      case "link": {
        const l = t as Tokens.Link;
        out.push(...inlineRuns(l.tokens, style));
        if (l.href && l.href !== l.text) out.push(run(` (${l.href})`, style));
        break;
      }
      case "br":
        out.push(new TextRun({ text: "", break: 1 }));
        break;
      case "text": {
        const tt = t as Tokens.Text;
        if (tt.tokens?.length) out.push(...inlineRuns(tt.tokens, style));
        else out.push(run(decode(tt.text), style));
        break;
      }
      case "escape":
      case "html":
        out.push(run(decode((t as Tokens.Escape).text ?? ""), style));
        break;
      default:
        if ("text" in t && typeof t.text === "string") out.push(run(decode(t.text), style));
    }
  }
  return out;
}

function run(text: string, s: RunStyle): TextRun {
  return new TextRun({ text, bold: s.bold, italics: s.italics, font: s.code ? "Consolas" : undefined });
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

type Block = Paragraph | Table;

class Converter {
  private listInstance = 0;
  constructor(private readonly images?: ImageSource) {}

  blocks(tokens: Token[]): Block[] {
    const out: Block[] = [];
    for (const t of tokens) out.push(...this.block(t));
    return out;
  }

  private block(t: Token): Block[] {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        return [new Paragraph({ heading: HEADINGS[Math.min(h.depth, 6) - 1], children: inlineRuns(h.tokens) })];
      }
      case "paragraph": {
        const inner = (t as Tokens.Paragraph).tokens;
        const img = inner.length === 1 && inner[0].type === "image" ? (inner[0] as Tokens.Image) : null;
        const pic = img && this.images ? this.images(img.href) : null;
        if (img && pic)
          return [
            new Paragraph({ children: [new ImageRun({ type: "png", data: pic.data, transformation: { width: pic.width, height: pic.height } })], spacing: { before: 120 } }),
            new Paragraph({ children: [run(img.text, { italics: true })], spacing: { after: 200 } }),
          ];
        return [new Paragraph({ children: inlineRuns(inner), spacing: { after: 120 } })];
      }
      case "list":
        return this.list(t as Tokens.List, 0);
      case "table":
        return [this.table(t as Tokens.Table)];
      case "blockquote":
        return this.blocks((t as Tokens.Blockquote).tokens);
      case "code":
        return (t as Tokens.Code).text
          .split("\n")
          .map((line) => new Paragraph({ children: [run(line, { code: true })] }));
      case "hr":
        return [
          new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } }, children: [] }),
        ];
      case "space":
        return [];
      default:
        if ("text" in t && typeof t.text === "string" && t.text.trim()) {
          return [new Paragraph({ children: [run(decode(t.text), {})] })];
        }
        return [];
    }
  }

  private list(list: Tokens.List, level: number): Block[] {
    const instance = list.ordered ? ++this.listInstance : 0;
    const out: Block[] = [];
    for (const item of list.items) {
      let first = true;
      for (const child of item.tokens) {
        if (child.type === "list") {
          out.push(...this.list(child as Tokens.List, Math.min(level + 1, 4)));
          continue;
        }
        const runs =
          child.type === "text" || child.type === "paragraph"
            ? inlineRuns((child as Tokens.Text).tokens ?? [], {})
            : [run("text" in child ? String(child.text) : "", {})];
        if (item.task) runs.unshift(run(item.checked ? "☑ " : "☐ ", {}));
        out.push(
          first
            ? new Paragraph({
                children: runs,
                ...(list.ordered
                  ? { numbering: { reference: "numbered", level, instance } }
                  : { bullet: { level } }),
              })
            : new Paragraph({ children: runs, indent: { left: 720 * (level + 1) } }),
        );
        first = false;
      }
    }
    return out;
  }

  private table(t: Tokens.Table): Table {
    const cell = (tokens: Token[], header: boolean) =>
      new TableCell({
        children: [new Paragraph({ children: inlineRuns(tokens, header ? { bold: true } : {}) })],
      });
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: t.header.map((h) => cell(h.tokens, true)) }),
        ...t.rows.map((r) => new TableRow({ children: r.map((c) => cell(c.tokens, false)) })),
      ],
    });
  }
}

export async function markdownToDocx(markdown: string, title?: string, opts: { images?: ImageSource } = {}): Promise<Buffer> {
  const tokens = marked.lexer(markdown);
  const children = new Converter(opts.images).blocks(tokens);
  const doc = new Document({
    title,
    creator: "HR Assistant",
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: {
      config: [
        {
          reference: "numbered",
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph("")] }],
  });
  return Packer.toBuffer(doc);
}
