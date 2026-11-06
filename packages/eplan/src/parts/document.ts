import { attributes, fileTokens, withAttributes, type XmlToken, XmlScanner } from "./xml";

// The parts of an EPLAN parts export, as the doctor needs them. An empty property is left out
// of the export; multi-language text is `xx_XX@text;` repeated, `??_??@` meaning no language.

/** The attributes the rules and fixes look at (EPLAN's property names). */
const PART_PROPERTIES = [
  "P_ARTICLE_PARTNR",
  "P_ARTICLE_ERPNR",
  "P_ARTICLE_DISCONTINUED",
  "P_ARTICLE_MANUFACTURER",
  "P_ARTICLE_NOTE",
  "P_ARTICLE_GROUPSYMBOLMACRO",
  "P_ARTICLE_PICTUREFILE",
  "P_ARTICLE_DESCR1",
  "P_ARTICLE_ORDERNR",
  "P_ARTICLE_TYPENR",
  "P_ARTICLE_PRODUCTGROUP",
  "P_ARTICLE_PRODUCTSUBGROUP",
] as const;

export interface PartRecord {
  partNumber: string;
  /** The `PART_PROPERTIES` the part has; a missing key means the property is empty. */
  properties: Record<string, string>;
  variants: number;
  /** Function templates over all variants. */
  functionTemplates: number;
}

/** Reads every part of an export file, without keeping the whole file in memory. */
export async function readPartsFile(path: string): Promise<PartRecord[]> {
  const parts: PartRecord[] = [];
  let current: PartRecord | null = null;
  for await (const token of fileTokens(path)) {
    current = step(token, current, parts);
  }
  return parts;
}

function step(token: XmlToken, current: PartRecord | null, parts: PartRecord[]): PartRecord | null {
  if (token.kind === "open" && token.name === "part") {
    const record = partRecord(token.raw);
    if (token.selfClosing) {
      parts.push(record);
      return null;
    }
    return record;
  }
  if (!current) return null;
  if (token.kind === "open" && token.name === "variant") current.variants += 1;
  else if (token.kind === "open" && token.name === "functiontemplate") {
    current.functionTemplates += 1;
  } else if (token.kind === "close" && token.name === "part") {
    parts.push(current);
    return null;
  }
  return current;
}

const WANTED = new Set<string>(PART_PROPERTIES);

function partRecord(raw: string): PartRecord {
  const properties: Record<string, string> = {};
  for (const [key, value] of attributes(raw)) {
    if (WANTED.has(key)) properties[key] = value;
  }
  return {
    partNumber: properties["P_ARTICLE_PARTNR"] ?? "",
    properties,
    variants: 0,
    functionTemplates: 0,
  };
}

/** A small export (the parts of one batch) with each part's text kept, so it can be re-imported. */
export interface PartsDocument {
  /** `<partsmanagement …>`, the root's open tag. */
  root: string;
  parts: Array<{ record: PartRecord; raw: string }>;
}

export function parsePartsDocument(text: string): PartsDocument {
  const scanner = new XmlScanner();
  const tokens = [...scanner.push(text), ...scanner.end()];
  let root = "";
  const parts: PartsDocument["parts"] = [];
  let current: PartRecord | null = null;
  let raw: string[] = [];
  for (const token of tokens) {
    if (token.kind === "open" && token.name === "partsmanagement") {
      root = token.raw;
      continue;
    }
    const before = current;
    if (before || (token.kind === "open" && token.name === "part")) raw.push(token.raw);
    const finished: PartRecord[] = [];
    current = step(token, current, finished);
    const [done] = finished;
    if (done) {
      parts.push({ record: done, raw: raw.join("") });
      raw = [];
    }
  }
  if (!root) throw new Error("This is not an EPLAN parts export: no <partsmanagement> element.");
  return { root, parts };
}

/**
 * The import file for a batch: the parts as exported, with only the changed attributes
 * rewritten. Whole parts are written, so an update can't blank what it didn't mention.
 */
export function updateDocument(
  document: PartsDocument,
  changes: ReadonlyMap<string, Record<string, string | null>>,
): string {
  const parts = document.parts
    .filter((part) => changes.has(part.record.partNumber))
    .map((part) => {
      const change = changes.get(part.record.partNumber) ?? {};
      const end = part.raw.indexOf(">") + 1;
      const open = part.raw.slice(0, end);
      return withAttributes(open, change) + part.raw.slice(end);
    });
  const root = withAttributes(document.root, { count: String(parts.length) });
  return `<?xml version="1.0" encoding="utf-8" ?>\r\n${root}\r\n${parts.map((p) => ` ${p}`).join("\r\n")}\r\n</partsmanagement>\r\n`;
}

/** All attributes of a part's open tag, decoded. */
export function partAttributes(raw: string): Map<string, string> {
  const end = raw.indexOf(">") + 1;
  return new Map(attributes(raw.slice(0, end)));
}

// Multi-language values.

const LANGUAGE_TEXT = /([a-z]{2}_[A-Z]{2}|\?\?_\?\?)@([^;]*);/g;
const MULTI_LANGUAGE = /^([a-z]{2}_[A-Z]{2}|\?\?_\?\?)@/;

/** "es_ES@Contactor;en_US@Contactor;" → es_ES, en_US. A plain value counts as "??_??". */
export function languages(value: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (value === undefined) return out;
  if (!MULTI_LANGUAGE.test(value)) {
    if (value.trim()) out.set("??_??", value);
    return out;
  }
  for (const match of value.matchAll(LANGUAGE_TEXT)) out.set(match[1] ?? "", match[2] ?? "");
  return out;
}

/** Whether a property has no text in any language. */
export function isEmpty(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (!MULTI_LANGUAGE.test(value)) return value.trim() === "";
  return [...languages(value).values()].every((text) => text.trim() === "");
}

/** Sets one language's text, keeping the others. ";" can't be stored in EPLAN's format. */
export function withLanguage(value: string | undefined, language: string, text: string): string {
  const map = languages(value);
  map.set(language, text.replaceAll(";", ","));
  return [...map].map(([lang, t]) => `${lang}@${t};`).join("");
}

/** The text in `language`, else the language-neutral one, else the first there is. */
export function textIn(value: string | undefined, language: string): string {
  const map = languages(value);
  return map.get(language) || map.get("??_??") || [...map.values()].find((t) => t.trim()) || "";
}

/** "es" → "es_ES", as EPLAN names languages. */
export function eplanLanguage(appLanguage: string): string {
  const known: Record<string, string> = {
    en: "en_US",
    es: "es_ES",
    de: "de_DE",
    fr: "fr_FR",
    it: "it_IT",
    pt: "pt_PT",
  };
  const base = appLanguage.slice(0, 2).toLowerCase();
  return known[base] ?? "en_US";
}
