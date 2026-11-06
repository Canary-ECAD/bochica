import { createReadStream } from "node:fs";

// EPLAN's parts export (XPamExportXml): `<partsmanagement …>` with one `<part …>` per part, its
// properties as attributes and its variants, function templates and the rest as children. The
// file can be large (about 80 MB for 14,000 parts), so it is read as a stream of tags. The format
// is machine-written: no DTD, no CDATA, attribute values in double quotes.

/** One piece of the document: a tag, or what lies between two tags. */
export type XmlToken =
  | { kind: "open"; name: string; raw: string; selfClosing: boolean }
  | { kind: "close"; name: string; raw: string }
  | { kind: "text"; raw: string }
  /** `<?xml …?>`, comments and anything else that is not an element. */
  | { kind: "other"; raw: string };

/** Splits XML text into tokens as it arrives; a tag cut by a chunk boundary waits for the rest. */
export class XmlScanner {
  private buffer = "";

  push(chunk: string): XmlToken[] {
    this.buffer += chunk;
    const tokens: XmlToken[] = [];
    let at = 0;
    for (;;) {
      const open = this.buffer.indexOf("<", at);
      if (open === -1) {
        // Text up to the end may continue in the next chunk; keep it.
        break;
      }
      if (open > at) tokens.push({ kind: "text", raw: this.buffer.slice(at, open) });
      const end = tagEnd(this.buffer, open);
      if (end === -1) {
        at = open;
        this.buffer = this.buffer.slice(at);
        return tokens;
      }
      tokens.push(token(this.buffer.slice(open, end + 1)));
      at = end + 1;
    }
    this.buffer = this.buffer.slice(at);
    return tokens;
  }

  /** What is left once the input ended: trailing text, or an unfinished tag (an error). */
  end(): XmlToken[] {
    const rest = this.buffer;
    this.buffer = "";
    if (!rest) return [];
    if (rest.includes("<")) throw new Error("The XML file ends in the middle of a tag.");
    return [{ kind: "text", raw: rest }];
  }
}

/** Index of the `>` closing the tag that starts at `open`, skipping quoted values; -1 if none yet. */
function tagEnd(text: string, open: number): number {
  if (text.startsWith("<!--", open)) {
    const end = text.indexOf("-->", open + 4);
    return end === -1 ? -1 : end + 2;
  }
  let quote: string | null = null;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

const NAME = /^<\/?([A-Za-z_][\w.:-]*)/;

function token(raw: string): XmlToken {
  if (raw.startsWith("<?") || raw.startsWith("<!")) return { kind: "other", raw };
  const name = NAME.exec(raw)?.[1] ?? "";
  if (raw.startsWith("</")) return { kind: "close", name, raw };
  return { kind: "open", name, raw, selfClosing: raw.endsWith("/>") };
}

const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** The attributes of an open tag, decoded, in the order they appear. */
export function attributes(raw: string): Array<[string, string]> {
  const start = NAME.exec(raw)?.[0].length ?? 0;
  const out: Array<[string, string]> = [];
  for (const match of raw.slice(start).matchAll(ATTRIBUTE)) {
    out.push([match[1] ?? "", decode(match[2] ?? match[3] ?? "")]);
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decode(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

/** Encodes an attribute value; line breaks and tabs as character references, so they survive. */
export function encode(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\r", "&#xD;")
    .replaceAll("\n", "&#xA;")
    .replaceAll("\t", "&#x9;");
}

/** Reads a file as tokens, a chunk at a time. */
export async function* fileTokens(path: string): AsyncGenerator<XmlToken> {
  const scanner = new XmlScanner();
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 });
  for await (const chunk of stream) {
    yield* scanner.push(chunk as string);
  }
  yield* scanner.end();
}

/** Turns a tag back into text with some attributes changed (null removes one). */
export function withAttributes(raw: string, changes: Record<string, string | null>): string {
  const name = NAME.exec(raw)?.[1] ?? "";
  const close = raw.endsWith("/>") ? " />" : ">";
  const pending = new Map(Object.entries(changes));
  const parts: string[] = [];
  for (const [key, value] of attributes(raw)) {
    if (pending.has(key)) {
      const next = pending.get(key);
      pending.delete(key);
      if (next !== null && next !== undefined) parts.push(`${key}="${encode(next)}"`);
    } else {
      parts.push(`${key}="${encode(value)}"`);
    }
  }
  for (const [key, value] of pending) {
    if (value !== null) parts.push(`${key}="${encode(value)}"`);
  }
  return `<${name}${parts.length > 0 ? " " : ""}${parts.join(" ")}${close}`;
}
