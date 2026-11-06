import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  eplanLanguage,
  isEmpty,
  languages,
  partAttributes,
  parsePartsDocument,
  readPartsFile,
  textIn,
  updateDocument,
  withLanguage,
} from "./document";
import { reportCard, reportCsv, reportText, runReport, selectRules } from "./report";
import { PART_RULES } from "./rules";
import { attributes, decode, encode, withAttributes, XmlScanner } from "./xml";

const sample = join(import.meta.dir, "..", "fixtures", "parts-sample.xml");

describe("xml", () => {
  test("a tag cut by a chunk boundary waits for the rest", () => {
    const scanner = new XmlScanner();
    const first = scanner.push('<root><part a="1 > 2');
    const second = scanner.push('" b="x"/></root>');
    const tokens = [...first, ...second, ...scanner.end()];
    expect(tokens.map((t) => t.kind)).toEqual(["open", "open", "close"]);
    const part = tokens[1];
    expect(part?.kind === "open" && part.selfClosing).toBe(true);
    expect(attributes(part?.raw ?? "")).toEqual([
      ["a", "1 > 2"],
      ["b", "x"],
    ]);
  });

  test("an unfinished tag at the end is an error", () => {
    const scanner = new XmlScanner();
    scanner.push('<root><part a="1');
    expect(() => scanner.end()).toThrow("middle of a tag");
  });

  test("entities and line breaks round-trip", () => {
    const value = 'A & B < "C"\r\nnext\tline';
    expect(decode(encode(value))).toBe(value);
    expect(decode("&#xD;&#xA;&#65;&apos;")).toBe("\r\nA'");
  });

  test("withAttributes changes, adds and removes attributes, keeping the order", () => {
    const tag = '<part a="1" b="2" c="3">';
    expect(withAttributes(tag, { b: "two & more", c: null, d: "4" })).toBe(
      '<part a="1" b="two &amp; more" d="4">',
    );
    expect(withAttributes('<part a="1" />', { a: "2" })).toBe('<part a="2" />');
  });
});

describe("languages", () => {
  test("parse, check and set", () => {
    expect([...languages("es_ES@Uno;en_US@One;")]).toEqual([
      ["es_ES", "Uno"],
      ["en_US", "One"],
    ]);
    expect(languages("plain text").get("??_??")).toBe("plain text");
    expect(isEmpty(undefined)).toBe(true);
    expect(isEmpty("??_??@;")).toBe(true);
    expect(isEmpty("es_ES@ ;en_US@x;")).toBe(false);
    expect(withLanguage("??_??@Old;", "es_ES", "Nuevo; texto")).toBe(
      "??_??@Old;es_ES@Nuevo, texto;",
    );
    expect(withLanguage(undefined, "es_ES", "Nuevo")).toBe("es_ES@Nuevo;");
    expect(textIn("en_US@One;es_ES@Uno;", "es_ES")).toBe("Uno");
    expect(textIn("??_??@Neutral;en_US@One;", "es_ES")).toBe("Neutral");
    expect(eplanLanguage("es")).toBe("es_ES");
    expect(eplanLanguage("es-MX")).toBe("es_ES");
    expect(eplanLanguage("xx")).toBe("en_US");
  });
});

describe("parts document", () => {
  test("reads every part with its properties, variants and function templates", async () => {
    const parts = await readPartsFile(sample);
    expect(parts.map((p) => p.partNumber)).toEqual([
      "DEMO.CT-100",
      "DEMO.CT-200",
      "DEMO.CT-300",
      "DEMO.TB-10",
      'DEMO.LINE"2"',
    ]);
    const [first, , third, fourth, fifth] = parts;
    expect(first?.properties["P_ARTICLE_NOTE"]).toBe("??_??@Contactor 3 kW & 1 NO;");
    expect(first?.functionTemplates).toBe(2);
    expect(third?.variants).toBe(1);
    expect(third?.functionTemplates).toBe(0);
    expect(fourth?.variants).toBe(2);
    expect(fifth?.variants).toBe(0);
    expect(fifth?.properties["P_ARTICLE_NOTE"]).toBe("??_??@First line\r\nsecond line;");
  });

  test("the update file keeps whole parts and changes only what was asked", () => {
    const document = parsePartsDocument(readFileSync(sample, "utf8"));
    expect(document.root).toContain("<partsmanagement");
    expect(document.parts).toHaveLength(5);
    const xml = updateDocument(
      document,
      new Map([
        ["DEMO.CT-200", { P_ARTICLE_ERPNR: "100002", P_ARTICLE_NOTE: "es_ES@Contactor;" }],
        ['DEMO.LINE"2"', { P_ARTICLE_ERPNR: "200021" }],
      ]),
    );
    const again = parsePartsDocument(xml);
    expect(again.root).toContain('count="2"');
    expect(again.parts.map((p) => p.record.partNumber)).toEqual(["DEMO.CT-200", 'DEMO.LINE"2"']);
    const [changed, line] = again.parts;
    const before = partAttributes(document.parts[1]?.raw ?? "");
    const after = partAttributes(changed?.raw ?? "");
    expect(after.get("P_ARTICLE_ERPNR")).toBe("100002");
    expect(after.get("P_ARTICLE_NOTE")).toBe("es_ES@Contactor;");
    for (const [key, value] of before)
      if (key !== "P_ARTICLE_ERPNR") expect(after.get(key)).toBe(value);
    // The children come along untouched.
    expect(changed?.record.functionTemplates).toBe(1);
    expect(changed?.raw).toContain('functiondefid="1"');
    // Line breaks in another field survive the trip.
    expect(line?.record.properties["P_ARTICLE_NOTE"]).toBe("??_??@First line\r\nsecond line;");
  });

  test("a file without the root element is refused", () => {
    expect(() => parsePartsDocument("<other/>")).toThrow("not an EPLAN parts export");
  });
});

describe("rules and report", () => {
  const ids = PART_RULES.map((r) => r.id);

  test("rule ids are unique and every rule but one names its property number", () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(PART_RULES.filter((r) => r.propertyId === undefined).map((r) => r.id)).toEqual([
      "function-templates",
    ]);
  });

  test("each rule flags the planted parts", async () => {
    const parts = await readPartsFile(sample);
    const result = runReport(parts);
    const flagged = Object.fromEntries(
      result.findings.map((f) => [f.rule.id, f.parts.map((p) => p.partNumber)]),
    );
    expect(flagged).toEqual({
      "erp-number": ["DEMO.CT-200"],
      manufacturer: ["DEMO.TB-10"],
      description: ["DEMO.CT-200", "DEMO.TB-10"],
      "schematic-macro": ["DEMO.CT-200", "DEMO.TB-10"],
      picture: [],
      "function-templates": ["DEMO.CT-300", 'DEMO.LINE"2"'],
      "part-number": [],
    });
    // Serious first, minor last.
    expect(result.findings.at(-1)?.rule.id).toBe("part-number");
    expect(result.total).toBe(5);
  });

  test("a discontinued part needs no ERP number", async () => {
    const parts = await readPartsFile(sample);
    const result = runReport(parts, { rules: ["erp-number"], partNumbers: ["DEMO.CT-300"] });
    expect(result.findings[0]?.parts).toEqual([]);
  });

  test("filters by product group and manufacturer", async () => {
    const parts = await readPartsFile(sample);
    expect(runReport(parts, { productGroup: "7" }).total).toBe(2);
    expect(runReport(parts, { manufacturer: "demo" }).total).toBe(4);
  });

  test("unknown rules are refused with the list of known ones", () => {
    expect(() => selectRules(["nope"])).toThrow("Known rules");
  });

  test("card, CSV and text", async () => {
    const parts = await readPartsFile(sample);
    const result = runReport(parts);
    const card = reportCard(result, "C:\\Work\\report.csv", 1);
    expect(card.rules.find((r) => r.id === "description")).toEqual({
      id: "description",
      severity: "serious",
      count: 2,
      examples: ["DEMO.CT-200"],
    });
    const csv = reportCsv(result, "es_ES");
    expect(csv.startsWith("\uFEFFpart_number;rule;severity")).toBe(true);
    expect(csv).toContain("DEMO.CT-200;erp-number;serious;22056;DEMO;");
    expect(csv).toContain('"DEMO.LINE""2""";function-templates');
    const text = reportText(result, "C:\\Work\\report.csv", "es_ES");
    expect(text).toContain("erp-number (property 22056), serious: 1 parts");
    // A description of several lines stays on one.
    expect(text).not.toContain("First line\r\nsecond");
  });

  test("long descriptions are cut in the model's text", () => {
    const long = {
      partNumber: "P1",
      properties: { P_ARTICLE_NOTE: `??_??@${"x".repeat(200)};` },
      variants: 1,
      functionTemplates: 0,
    };
    const text = reportText(runReport([long], { rules: ["function-templates"] }), "c.csv", "es_ES");
    expect(text).toContain(`P1: ${"x".repeat(79)}…`);
  });
});
