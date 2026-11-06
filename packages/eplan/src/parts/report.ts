import type { PartsReport } from "@bochica/shared";
import { type PartRecord, textIn } from "./document";
import { PART_RULES, type PartRule, SEVERITIES } from "./rules";

// The health report: every rule run over every part, computed here, never by the model.

export interface ReportOptions {
  /** Only these rules; all of them when absent or empty. */
  rules?: readonly string[];
  /** Only parts of this product group (the export's number) or manufacturer (short name). */
  productGroup?: string;
  manufacturer?: string;
  /** Only these part numbers. */
  partNumbers?: readonly string[];
}

interface Finding {
  rule: PartRule;
  parts: PartRecord[];
}

export interface ReportResult {
  total: number;
  findings: Finding[];
}

export function selectRules(ids: readonly string[] | undefined): PartRule[] {
  if (!ids || ids.length === 0) return [...PART_RULES];
  const unknown = ids.filter((id) => !PART_RULES.some((rule) => rule.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown rule ${unknown.join(", ")}. Known rules: ${PART_RULES.map((r) => r.id).join(", ")}.`,
    );
  }
  return PART_RULES.filter((rule) => ids.includes(rule.id));
}

export function runReport(parts: readonly PartRecord[], options: ReportOptions = {}): ReportResult {
  const rules = selectRules(options.rules);
  const wanted = options.partNumbers ? new Set(options.partNumbers) : null;
  const manufacturer = options.manufacturer?.trim().toLowerCase();
  const selected = parts.filter(
    (part) =>
      (!wanted || wanted.has(part.partNumber)) &&
      (!options.productGroup ||
        part.properties["P_ARTICLE_PRODUCTGROUP"] === options.productGroup) &&
      (!manufacturer || part.properties["P_ARTICLE_MANUFACTURER"]?.toLowerCase() === manufacturer),
  );
  const findings = rules.map((rule) => ({ rule, parts: selected.filter((p) => rule.fails(p)) }));
  findings.sort(
    (a, b) => SEVERITIES.indexOf(a.rule.severity) - SEVERITIES.indexOf(b.rule.severity),
  );
  return { total: selected.length, findings };
}

/** What the report card shows: counts and a few part numbers per rule. */
export function reportCard(result: ReportResult, csv: string, examples = 5): PartsReport {
  return {
    kind: "parts-report",
    total: result.total,
    csv,
    rules: result.findings.map(({ rule, parts }) => ({
      id: rule.id,
      severity: rule.severity,
      count: parts.length,
      examples: parts.slice(0, examples).map((p) => p.partNumber),
    })),
  };
}

const csvCell = (value: string): string =>
  /[";\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** One row per part and failed rule; `;` separated, as Excel expects in most of Europe. */
export function reportCsv(result: ReportResult, language: string): string {
  const header = ["part_number", "rule", "severity", "property", "manufacturer", "description"];
  const rows = [header.join(";")];
  for (const { rule, parts } of result.findings) {
    for (const part of parts) {
      rows.push(
        [
          part.partNumber,
          rule.id,
          rule.severity,
          rule.propertyId ? String(rule.propertyId) : "",
          part.properties["P_ARTICLE_MANUFACTURER"] ?? "",
          textIn(part.properties["P_ARTICLE_NOTE"], language),
        ]
          .map(csvCell)
          .join(";"),
      );
    }
  }
  // A byte order mark, so Excel reads the file as UTF-8.
  return `﻿${rows.join("\r\n")}\r\n`;
}

/** The model's view: counts per rule and up to `examples` parts each, with what they lack. */
export function reportText(
  result: ReportResult,
  csv: string,
  language: string,
  examples = 10,
): string {
  const lines = [`Checked ${result.total} parts. Full list: ${csv}`, ""];
  for (const { rule, parts } of result.findings) {
    const property = rule.propertyId ? ` (property ${rule.propertyId})` : "";
    lines.push(`${rule.id}${property}, ${rule.severity}: ${parts.length} parts`);
    for (const part of parts.slice(0, examples)) {
      const description = textIn(part.properties["P_ARTICLE_NOTE"], language);
      const manufacturer = part.properties["P_ARTICLE_MANUFACTURER"] ?? "";
      lines.push(
        `  - ${part.partNumber}${manufacturer ? ` [${manufacturer}]` : ""}${description ? `: ${description}` : ""}`,
      );
    }
    if (parts.length > examples) lines.push(`  … ${parts.length - examples} more in the CSV`);
  }
  return lines.join("\n");
}
