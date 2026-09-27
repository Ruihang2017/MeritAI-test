// Lists the English strings people read in the browser UI (web/src), to keep the Chinese dictionary
// (web/src/i18n/zh.ts) complete: JSX text, readable props, and string or template literals that read
// as words. Prints the ones the dictionary doesn't cover yet (--all: every string).
//
//   npx tsx scripts/ui-strings.ts [--all]
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ZH, ZH_PATTERNS } from "../web/src/i18n/zh";

// Babel's parser (a dependency of the React plugin): TypeScript 7 has no JS API.
const { parse } = createRequire(import.meta.url)("@babel/parser") as { parse: (src: string, o: object) => Node };
interface Node {
  type: string;
  [k: string]: unknown;
}

const ROOT = join(process.cwd(), "web", "src");
const files: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !p.includes("i18n")) files.push(p);
  }
};
walk(ROOT);

const READABLE_PROPS = new Set(["placeholder", "aria-label", "title", "alt", "label"]);
const CODE_PROPS = new Set(["className", "style", "key", "type", "role", "id", "htmlFor", "href", "rel", "target", "accept", "inputMode", "autoComplete", "name", "value", "d", "viewBox", "fill", "stroke"]);
const CODE_KEYS = new Set(["className", "background", "color", "borderColor", "fontWeight", "gridTemplateColumns", "flexDirection", "alignItems", "justifyContent", "whiteSpace", "textAlign", "overflow", "method", "kind", "event", "page", "tone", "icon", "key", "id"]);
const CODE_CALLS = /(^|\.)(call|getItem|setItem|removeItem|test|replace|startsWith|endsWith|includes|split|querySelector|closest|addEventListener|removeEventListener|localeCompare|padStart|toLocaleString|join)$/;
const strings = new Set<string>();
const templates = new Set<string>();
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const calleeName = (c: Node): string => {
  if (c.type === "Identifier") return String(c.name);
  if (c.type === "MemberExpression") return `${calleeName(c.object as Node)}.${String((c.property as Node).name ?? "")}`;
  return "";
};

function visit(n: unknown, attr: string | null): void {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) return n.forEach((c) => visit(c, attr));
  const node = n as Node;
  if (typeof node.type !== "string") return;
  switch (node.type) {
    case "ImportDeclaration":
    case "ExportAllDeclaration":
    case "TSTypeAnnotation":
    case "TSTypeAliasDeclaration":
    case "TSInterfaceDeclaration":
    case "TSLiteralType":
      return;
    case "JSXAttribute": {
      const name = String((node.name as Node).name);
      if (CODE_PROPS.has(name)) return;
      return visit(node.value, name);
    }
    case "ObjectProperty": {
      const k = node.key as Node;
      if (CODE_KEYS.has(String(k.name ?? k.value ?? ""))) return;
      break;
    }
    case "CallExpression":
      if (CODE_CALLS.test(calleeName(node.callee as Node))) return;
      break;
    case "BinaryExpression":
      if (["===", "!==", "==", "!="].includes(String(node.operator))) return;
      break;
    case "SwitchCase":
      return visit(node.consequent, attr);
    case "JSXText": {
      const t = norm(String(node.value));
      if (/[A-Za-z]{2}/.test(t)) strings.add(t);
      return;
    }
    case "StringLiteral": {
      const t = norm(String(node.value));
      if (/[A-Za-z]{2}/.test(t) && !/^(https?:|mailto:)/.test(t) && (attr ? READABLE_PROPS.has(attr) : / /.test(t) || /^[A-Z][a-z]+$/.test(t))) strings.add(t);
      return;
    }
    case "TemplateLiteral": {
      const q = (node.quasis as Node[]).map((x) => String((x.value as { cooked: string }).cooked));
      const t = norm(q.join("{}"));
      if ((node.expressions as unknown[]).length === 0) {
        if (/[A-Za-z]{2}/.test(t) && / /.test(t)) strings.add(t);
      } else if (/[A-Za-z]{3}/.test(t.replace(/\{\}/g, "")) && / /.test(t)) templates.add(t);
      break;
    }
  }
  for (const [k, v] of Object.entries(node)) if (!["loc", "start", "end", "leadingComments", "trailingComments", "innerComments", "extra"].includes(k)) visit(v, attr);
}

for (const f of files) visit(parse(readFileSync(f, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] }), null);

const all = process.argv.includes("--all");
const covered = (s: string) => ZH[s] !== undefined || ZH_PATTERNS.some(([re]) => re.test(s));
const missing = [...strings].filter((s) => all || !covered(s)).sort();
console.log(JSON.stringify({ strings: missing, templates: [...templates].sort() }, null, 1));
console.error(`${strings.size} strings (${missing.length} ${all ? "listed" : "not in the dictionary"}), ${templates.size} templates`);
