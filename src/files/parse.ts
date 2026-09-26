import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

/** Readable input formats. Anything else gets a clear message. */
export const READABLE = [".pdf", ".docx", ".txt", ".md"];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Text beyond this is cut; roughly 15k tokens. */
export const MAX_TEXT_CHARS = 60_000;
/** A PDF averaging fewer extracted characters per page than this is treated as scanned. */
const MIN_CHARS_PER_PAGE = 20;

export interface Extracted {
  text: string;
  truncated: boolean;
  pages?: number;
}

export class UnreadableFileError extends Error {}

export async function extractText(path: string): Promise<Extracted> {
  const ext = extname(path).toLowerCase();
  const size = (await stat(path)).size;
  if (size > MAX_FILE_BYTES) throw new UnreadableFileError(`file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);

  let text: string;
  let pages: number | undefined;
  switch (ext) {
    case ".pdf": {
      const { getDocumentProxy, extractText: pdfText } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
      const r = await pdfText(pdf, { mergePages: true });
      pages = r.totalPages;
      text = r.text;
      if (text.replace(/\s/g, "").length < MIN_CHARS_PER_PAGE * Math.max(1, pages)) {
        throw new UnreadableFileError("this PDF has no text layer (probably a scan or image); OCR is not supported yet");
      }
      break;
    }
    case ".docx": {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: await readFile(path) })).value;
      break;
    }
    case ".txt":
    case ".md":
      text = (await readFile(path, "utf8")).replace(/^﻿/, "");
      break;
    case ".doc":
      throw new UnreadableFileError("old .doc format is not supported; open it in Word and save as .docx");
    default:
      throw new UnreadableFileError(`unsupported file type "${ext || "(none)"}"; supported: ${READABLE.join(", ")}`);
  }

  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = text.length > MAX_TEXT_CHARS;
  return { text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text, truncated, pages };
}
