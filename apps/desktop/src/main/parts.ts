import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool, ToolRunResult } from "@bochica/agent";
import {
  DataPortalError,
  eplanLanguage,
  type Fetch,
  FIX_FIELDS,
  type FixField,
  isEmpty,
  lookUpParts,
  MULTI_LANGUAGE_FIELDS,
  partAttributes,
  type PartsDocument,
  parsePartsDocument,
  type PortalPart,
  readPartsFile,
  reportCard,
  reportCsv,
  reportText,
  RULE_IDS,
  runReport,
  textIn,
  updateDocument,
  withLanguage,
} from "@bochica/eplan";
import type { PartsFixPreview } from "@bochica/shared";

// The parts database doctor (S15): tools that compute the report, look parts up on the Data
// Portal and apply fixes in batches. Every write is preceded, once per session, by a full export
// kept as a backup, and followed by a smoke test; a failed test stops further batches.

export type CallEplan = (
  tool: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<{ ok: boolean; text: string }>;

export interface PartsDeps {
  call: CallEplan;
  /** Where exports for the report and the batches go (userData\parts). */
  workRoot: string;
  /** Where the backups go (userData\backups\parts). */
  backupRoot: string;
  fetch: Fetch;
  now?: () => Date;
}

export interface PartsContext {
  sessionId: string;
  /** The session's working folder, where the report's CSV goes. */
  folder: string;
  /** The app's language ("es"). */
  language: string;
}

/** Parts per `parts_fix` batch. */
const MAX_BATCH = 100;
/** Parts per `parts_lookup` call. */
const MAX_LOOKUP = 200;
/** Long enough for a full export of a large database. */
const EXPORT_TIMEOUT_MS = 15 * 60_000;
/** A preview's export is reused by the call it was made for within this time. */
const PREVIEW_TTL_MS = 10 * 60_000;
/** Attributes EPLAN itself updates on every change; the smoke test ignores them. */
const STAMPS = new Set([
  "P_PART_LASTCHANGE",
  "P_PART_LASTCHANGE_DATE_UTC",
  "P_PART_LASTCHANGE_DATE",
  "P_MESSAGEMGMT_MESSAGES",
]);

interface Change {
  partNumber: string;
  field: FixField;
  value: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const stamp = (d: Date): string =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** eplan-mcp answers `{ success: false, … }` for an action EPLAN refused. */
function failed(result: { ok: boolean; text: string }): boolean {
  if (!result.ok) return true;
  const json = parseJson(result.text);
  if (json?.["success"] === false) return true;
  const nested = json?.["results"];
  return (
    typeof nested === "object" &&
    nested !== null &&
    (nested as Record<string, unknown>)["success"] === false
  );
}

function strings(input: unknown, name: string): string[] | undefined {
  const value = (input as Record<string, unknown> | null)?.[name];
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim());
}

function stringField(input: unknown, name: string): string | undefined {
  const value = (input as Record<string, unknown> | null)?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The batch a `parts_fix` call asks for, or why it can't be run. */
export function parseChanges(input: unknown): Change[] | string {
  const raw = (input as Record<string, unknown> | null)?.["changes"];
  if (!Array.isArray(raw) || raw.length === 0) return "Give at least one change.";
  const changes: Change[] = [];
  for (const item of raw) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const partNumber = typeof entry["partNumber"] === "string" ? entry["partNumber"].trim() : "";
    const field = entry["field"];
    const value = typeof entry["value"] === "string" ? entry["value"].trim() : "";
    if (!partNumber) return "Every change needs its part number.";
    if (typeof field !== "string" || !(field in FIX_FIELDS)) {
      return `Unknown field ${String(field)}. Fields: ${Object.keys(FIX_FIELDS).join(", ")}.`;
    }
    if (!value) return `The new value for ${partNumber} is empty; parts_fix only fills fields in.`;
    if (value.length > 1_000) return `The new value for ${partNumber} is too long.`;
    changes.push({ partNumber, field: field as FixField, value });
  }
  const parts = new Set(changes.map((c) => c.partNumber));
  if (parts.size > MAX_BATCH)
    return `A batch takes at most ${MAX_BATCH} parts; this one has ${parts.size}. Split it.`;
  return changes;
}

/** The new attribute values per part, built on what the part holds now. */
function attributeChanges(
  document: PartsDocument,
  changes: readonly Change[],
  language: string,
): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const change of changes) {
    const part = document.parts.find((p) => p.record.partNumber === change.partNumber);
    if (!part) continue;
    const attribute = FIX_FIELDS[change.field];
    const current =
      out.get(change.partNumber)?.[attribute] ?? partAttributes(part.raw).get(attribute);
    const value = MULTI_LANGUAGE_FIELDS.has(change.field)
      ? withLanguage(current, language, change.value)
      : change.value;
    out.set(change.partNumber, { ...out.get(change.partNumber), [attribute]: value });
  }
  return out;
}

/**
 * What differs between the parts as they should be and as EPLAN exported them after the import:
 * one sentence per difference. EPLAN's own change stamps are ignored.
 */
function smokeTest(
  before: PartsDocument,
  expected: ReadonlyMap<string, Record<string, string>>,
  after: PartsDocument,
): string[] {
  const problems: string[] = [];
  for (const [partNumber, changes] of expected) {
    const was = before.parts.find((p) => p.record.partNumber === partNumber);
    const now = after.parts.find((p) => p.record.partNumber === partNumber);
    if (!was) continue;
    if (!now) {
      problems.push(`${partNumber} is no longer in the database.`);
      continue;
    }
    const want = new Map(partAttributes(was.raw));
    for (const [key, value] of Object.entries(changes)) want.set(key, value);
    const got = partAttributes(now.raw);
    for (const key of new Set([...want.keys(), ...got.keys()])) {
      if (STAMPS.has(key)) continue;
      if ((want.get(key) ?? "") !== (got.get(key) ?? "")) {
        problems.push(
          Object.hasOwn(changes, key)
            ? `${partNumber}: ${key} did not take the new value.`
            : `${partNumber}: ${key} changed although the batch didn't touch it.`,
        );
      }
    }
    if (was.record.variants !== now.record.variants) {
      problems.push(
        `${partNumber}: its variants went from ${was.record.variants} to ${now.record.variants}.`,
      );
    }
    if (was.record.functionTemplates !== now.record.functionTemplates) {
      problems.push(`${partNumber}: its function templates changed.`);
    }
  }
  return problems;
}

export class PartsService {
  private readonly backedUp = new Map<string, string>();
  /** Sessions whose smoke test failed: no more batches there. */
  private readonly halted = new Map<string, string>();
  private readonly previews = new Map<string, { document: PartsDocument; at: number }>();
  private readonly now: () => Date;

  constructor(private readonly deps: PartsDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  tools(context: PartsContext): AgentTool[] {
    return [this.reportTool(context), this.fixTool(context), this.lookupTool(context)];
  }

  /** Exports parts (all of them for `["*"]`) to an XML file and returns its path. */
  private async exportParts(
    folder: string,
    name: string,
    partNumbers: readonly string[],
    signal: AbortSignal,
  ): Promise<string> {
    mkdirSync(folder, { recursive: true });
    const base = join(folder, name);
    const result = await this.deps.call(
      "eplan_partsmanagement_export",
      { export_file: base, part_numbers: [...partNumbers] },
      AbortSignal.any([signal, AbortSignal.timeout(EXPORT_TIMEOUT_MS)]),
    );
    const file = `${base}.xml`;
    if (failed(result) || !existsSync(file) || statSync(file).size === 0) {
      throw new Error(`EPLAN could not export the parts: ${result.text.slice(0, 300)}`);
    }
    return file;
  }

  private sessionFolder(sessionId: string): string {
    return join(this.deps.workRoot, sessionId.replace(/[^\w-]/g, "_"));
  }

  private async exportDocument(
    context: PartsContext,
    partNumbers: readonly string[],
    signal: AbortSignal,
  ): Promise<PartsDocument> {
    const file = await this.exportParts(
      this.sessionFolder(context.sessionId),
      `batch-${stamp(this.now())}-${Math.random().toString(36).slice(2, 8)}`,
      partNumbers,
      signal,
    );
    return parsePartsDocument(readFileSync(file, "utf8"));
  }

  private reportTool(context: PartsContext): AgentTool {
    const language = eplanLanguage(context.language);
    return {
      name: "bochica__parts_report",
      server: "bochica",
      tool: "parts_report",
      description: [
        "Checks the EPLAN parts database against the doctor's rules and reports what is missing, by severity.",
        `Rules: ${RULE_IDS.join(", ")}. Exports the database through EPLAN (a large one takes a minute),`,
        "writes a CSV with every finding to the working folder and shows a report card. Read-only.",
        "Narrow it with rules, partNumbers, productGroup (EPLAN's number) or manufacturer (short name).",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          rules: { type: "array", items: { type: "string", enum: [...RULE_IDS] } },
          partNumbers: { type: "array", items: { type: "string" }, maxItems: 1000 },
          productGroup: { type: "string" },
          manufacturer: { type: "string" },
        },
      },
      approval: "never",
      execute: async (input, signal): Promise<ToolRunResult> => {
        const partNumbers = strings(input, "partNumbers");
        const file = await this.exportParts(
          this.sessionFolder(context.sessionId),
          "report",
          partNumbers && partNumbers.length > 0 ? partNumbers : ["*"],
          signal,
        );
        const parts = await readPartsFile(file);
        const rules = strings(input, "rules");
        const productGroup = stringField(input, "productGroup");
        const manufacturer = stringField(input, "manufacturer");
        const result = runReport(parts, {
          ...(rules ? { rules } : {}),
          ...(productGroup ? { productGroup } : {}),
          ...(manufacturer ? { manufacturer } : {}),
        });
        mkdirSync(context.folder, { recursive: true });
        const csv = join(context.folder, `parts-report-${stamp(this.now())}.csv`);
        writeFileSync(csv, reportCsv(result, language), "utf8");
        return {
          ok: true,
          text: reportText(result, csv, language),
          card: reportCard(result, csv),
        };
      },
    };
  }

  private fixTool(context: PartsContext): AgentTool {
    const language = eplanLanguage(context.language);
    const previewKey = (input: unknown) => `${context.sessionId}\u0000${JSON.stringify(input)}`;
    return {
      name: "bochica__parts_fix",
      server: "bochica",
      tool: "parts_fix",
      description: [
        `Fills in fields of parts in the EPLAN parts database, at most ${MAX_BATCH} parts per batch.`,
        `Fields: erp (22056), manufacturer (22007, EPLAN's short name), description (22009, written in the user's language, ${language}),`,
        "schematicMacro (22145, the macro path as EPLAN stores it), picture (22045).",
        "The user sees the batch as a table and approves it. Before the first batch of a session the whole database is backed up;",
        "after every batch Bochica checks that only the given fields changed. Never invent values, least of all ERP numbers.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          changes: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                partNumber: { type: "string" },
                field: { type: "string", enum: Object.keys(FIX_FIELDS) },
                value: { type: "string" },
              },
              required: ["partNumber", "field", "value"],
            },
          },
        },
        required: ["changes"],
      },
      approval: "ask",
      assess: (input) => {
        const halted = this.halted.get(context.sessionId);
        if (halted) {
          return {
            block: "parts-halted",
            reason: `An earlier batch in this session failed its check (${halted}), so no more changes are made here. The user should look at the parts first; the backup is ${this.backedUp.get(context.sessionId) ?? "listed in that result"}.`,
          };
        }
        const changes = parseChanges(input);
        return typeof changes === "string"
          ? { block: "parts-invalid", reason: changes }
          : { risks: [] };
      },
      preview: async (input, signal): Promise<PartsFixPreview | undefined> => {
        const changes = parseChanges(input);
        if (typeof changes === "string") return undefined;
        const numbers = [...new Set(changes.map((c) => c.partNumber))];
        const document = await this.exportDocument(context, numbers, signal);
        this.previews.set(previewKey(input), { document, at: Date.now() });
        return {
          kind: "parts-fix",
          parts: numbers.length,
          rows: changes.map((change) => {
            const part = document.parts.find((p) => p.record.partNumber === change.partNumber);
            const value = part ? partAttributes(part.raw).get(FIX_FIELDS[change.field]) : undefined;
            return {
              partNumber: change.partNumber,
              field: change.field,
              current: part
                ? MULTI_LANGUAGE_FIELDS.has(change.field)
                  ? textIn(value, language)
                  : (value ?? "")
                : "—",
              value: change.value,
            };
          }),
        };
      },
      execute: async (input, signal) => {
        const changes = parseChanges(input);
        if (typeof changes === "string") return { ok: false, text: changes };
        const numbers = [...new Set(changes.map((c) => c.partNumber))];
        const cached = this.previews.get(previewKey(input));
        this.previews.delete(previewKey(input));
        const before =
          cached && Date.now() - cached.at < PREVIEW_TTL_MS
            ? cached.document
            : await this.exportDocument(context, numbers, signal);
        const missing = numbers.filter((n) => !before.parts.some((p) => p.record.partNumber === n));
        if (missing.length > 0) {
          return {
            ok: false,
            text: `Nothing was changed: these parts are not in the database: ${missing.join(", ")}.`,
          };
        }

        let backup: string;
        try {
          backup = await this.ensureBackup(context.sessionId, signal);
        } catch (error) {
          return {
            ok: false,
            text: `Bochica could not back the parts database up first, so nothing was changed. Tell the user: ${error instanceof Error ? error.message : String(error)}`,
          };
        }

        const countBefore = await this.count(signal);
        const expected = attributeChanges(before, changes, language);
        const folder = this.sessionFolder(context.sessionId);
        const importFile = join(folder, `import-${stamp(this.now())}.xml`);
        writeFileSync(importFile, updateDocument(before, expected), "utf8");
        const imported = await this.deps.call(
          "eplan_partsmanagement_import",
          { import_file: importFile, format: "XPamImportXml", mode: 1 },
          AbortSignal.any([signal, AbortSignal.timeout(EXPORT_TIMEOUT_MS)]),
        );
        if (failed(imported)) {
          return {
            ok: false,
            text: `EPLAN did not import the batch: ${imported.text.slice(0, 300)}. Check the parts before trying again. Backup: ${backup}`,
          };
        }

        // The smoke test: the changed parts again, field by field, and the count.
        const after = await this.exportDocument(context, numbers, signal);
        const problems = smokeTest(before, expected, after);
        const countAfter = await this.count(signal);
        if (countBefore !== undefined && countAfter !== undefined && countBefore !== countAfter) {
          problems.push(
            `The database had ${countBefore} entries before the batch and ${countAfter} after.`,
          );
        }
        if (problems.length > 0) {
          this.halted.set(context.sessionId, problems[0] ?? "check failed");
          return {
            ok: false,
            text: [
              "The batch was imported but its check FAILED, so Bochica stops changing parts in this session.",
              ...problems.slice(0, 20).map((p) => `- ${p}`),
              `Tell the user what went wrong. The whole database as it was before this session's first change is in ${backup};`,
              "importing it with eplan_partsmanagement_import, mode 1 (update existing), puts the values back. Do that only if the user asks.",
            ].join("\n"),
          };
        }
        return {
          ok: true,
          text: `Changed ${expected.size} parts (${changes.length} fields); the check passed: only those fields changed and the database has the same number of entries. Backup of the database before this session's first change: ${backup}`,
        };
      },
    };
  }

  /** The whole database, once per session, before its first change. */
  private async ensureBackup(sessionId: string, signal: AbortSignal): Promise<string> {
    const done = this.backedUp.get(sessionId);
    if (done) return done;
    const file = await this.exportParts(
      this.deps.backupRoot,
      `parts-${stamp(this.now())}`,
      ["*"],
      signal,
    );
    this.backedUp.set(sessionId, file);
    return file;
  }

  /** Entries in the database (EPLAN counts variants), or undefined when EPLAN can't say. */
  private async count(signal: AbortSignal): Promise<number | undefined> {
    const result = await this.deps.call("eplan_parts_db_count", {}, signal).catch(() => undefined);
    if (!result || failed(result)) return undefined;
    const json = parseJson(result.text);
    const nested = json?.["results"] as Record<string, unknown> | undefined;
    const value = nested?.["count"] ?? json?.["count"];
    return typeof value === "number" ? value : undefined;
  }

  private lookupTool(context: PartsContext): AgentTool {
    const language = eplanLanguage(context.language);
    return {
      name: "bochica__parts_lookup",
      server: "bochica",
      tool: "parts_lookup",
      description: [
        "Looks parts up on the EPLAN Data Portal by their part number (22001) and says what the portal has for them:",
        "description per language, manufacturer, schematic macro, function templates, picture, lifecycle and its page.",
        "Compares with the parts database when EPLAN is connected and lists what could be filled in with parts_fix.",
        "Public data, no sign-in. Never use it to get an ERP number: those are the user's own.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          partNumbers: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: MAX_LOOKUP,
          },
        },
        required: ["partNumbers"],
      },
      approval: "never",
      execute: async (input, signal) => {
        const numbers = [...new Set(strings(input, "partNumbers") ?? [])].slice(0, MAX_LOOKUP);
        if (numbers.length === 0) return { ok: false, text: "Give at least one part number." };
        // What the database holds, when EPLAN is there; the lookup works without it.
        const local = await this.exportDocument(context, numbers, signal).catch(() => undefined);
        const manufacturers = new Map<string, string>();
        for (const part of local?.parts ?? []) {
          const m = part.record.properties["P_ARTICLE_MANUFACTURER"];
          if (m) manufacturers.set(part.record.partNumber, m);
        }
        let found: PortalPart[];
        try {
          found = await lookUpParts(this.deps.fetch, numbers, manufacturers);
        } catch (error) {
          if (error instanceof DataPortalError) return { ok: false, text: error.message };
          throw error;
        }
        const macros = local ? await this.masterDataFolder("$(MD_MACROS)", signal) : undefined;
        const onDisk = (path: string) =>
          macros !== undefined && existsSync(join(macros, path.replace(/^[\\/]+/, "")));
        // A download writes macros, pictures and part data into EPLAN's master data folders:
        // when one is read-only, the download fails inside EPLAN, so say so before queueing.
        const downloads = found.some((part) => {
          const mine = local?.parts.find((p) => p.record.partNumber === part.search)?.record;
          return (
            part.found &&
            part.schematicMacro !== undefined &&
            mine !== undefined &&
            isEmpty(mine.properties["P_ARTICLE_GROUPSYMBOLMACRO"]) &&
            !onDisk(part.schematicMacro)
          );
        });
        const readOnly = downloads ? await this.readOnlyMasterData(signal) : [];
        return { ok: true, text: lookupText(found, local, language, onDisk, readOnly) };
      },
    };
  }

  /** One of EPLAN's master data folders ($(MD_MACROS)…), or undefined when EPLAN can't say. */
  private async masterDataFolder(
    variable: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const result = await this.deps
      .call(
        "eplan_pathmap_substitute",
        { path_with_variables: variable },
        AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      )
      .catch(() => undefined);
    if (!result || failed(result)) return undefined;
    const nested = parseJson(result.text)?.["results"] as Record<string, unknown> | undefined;
    const path = nested?.["substituted"];
    return typeof path === "string" && path && !path.includes("$(") ? path : undefined;
  }

  /**
   * The master data folders a Data Portal download writes to that this user can't write to, as
   * "pictures folder X:\\Pictures". Checked by creating and deleting an empty file, since
   * Windows' permissions on a network share can't be read reliably any other way.
   */
  private async readOnlyMasterData(signal: AbortSignal): Promise<string[]> {
    const out: string[] = [];
    for (const [variable, name] of MASTER_DATA) {
      // oxlint-disable-next-line no-await-in-loop
      const folder = await this.masterDataFolder(variable, signal);
      if (folder && !writable(folder)) out.push(`${name} ${folder}`);
    }
    return out;
  }
}

/** The folders a Data Portal download writes into, with how the message names them. */
const MASTER_DATA: ReadonlyArray<[string, string]> = [
  ["$(MD_MACROS)", "macros folder"],
  ["$(MD_IMG)", "pictures folder"],
  ["$(MD_XML)", "XML folder"],
];

function writable(folder: string): boolean {
  if (!existsSync(folder)) return false;
  const probe = join(folder, `.bochica-write-test-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(probe, "");
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** How EPLAN stores a macro path in a part: relative to the macros folder's variable. */
export function macroValue(portalPath: string): string {
  return `$(MD_MACROS)\\${portalPath.replace(/^[\\/]+/, "").replaceAll("/", "\\")}`;
}

function lookupText(
  found: PortalPart[],
  local: PartsDocument | undefined,
  language: string,
  onDisk: (path: string) => boolean,
  readOnly: readonly string[] = [],
): string {
  const lines: string[] = [];
  const suggestions: string[] = [];
  const pick = (map: Record<string, string> | undefined) =>
    map ? map[language] || map["en_US"] || Object.values(map)[0] : undefined;
  for (const part of found) {
    if (!part.found) {
      lines.push(`- ${part.search}: not on the Data Portal (or another manufacturer's part).`);
      continue;
    }
    const description = pick(part.description);
    const facts = [
      part.manufacturer ? `manufacturer ${part.manufacturer}` : undefined,
      description ? `description "${description}"` : undefined,
      part.schematicMacro ? `schematic macro ${part.schematicMacro}` : "no schematic macro",
      `${part.functionTemplates ?? 0} function templates`,
      part.picture ? "a picture" : "no picture",
      part.lifecycle ? `lifecycle ${part.lifecycle}` : undefined,
    ].filter(Boolean);
    lines.push(
      `- ${part.search}: portal part ${part.partNumber} (id ${part.id}) ${part.url ?? ""}\n  ${facts.join("; ")}`,
    );
    const mine = local?.parts.find((p) => p.record.partNumber === part.search)?.record;
    if (!mine) continue;
    if (isEmpty(mine.properties["P_ARTICLE_NOTE"]) && description) {
      suggestions.push(`${part.search} description: "${description}"`);
    }
    if (isEmpty(mine.properties["P_ARTICLE_MANUFACTURER"]) && part.manufacturer) {
      suggestions.push(`${part.search} manufacturer: ${part.manufacturer}`);
    }
    if (isEmpty(mine.properties["P_ARTICLE_GROUPSYMBOLMACRO"]) && part.schematicMacro) {
      suggestions.push(
        onDisk(part.schematicMacro)
          ? `${part.search} schematicMacro: ${macroValue(part.schematicMacro)} (the file is in the macros folder)`
          : `${part.search} schematic macro: not in the macros folder yet. Queue it with eplan_dataportal_add_to_download_list (part_number ${part.partNumber}, dataportal_id ${part.id}), ask the user to download the list in EPLAN, then look it up again`,
      );
    }
  }
  if (!local)
    lines.push("", "EPLAN was not reachable, so this was not compared with the parts database.");
  if (suggestions.length > 0) {
    lines.push(
      "",
      "Could be filled in (ask the user, then parts_fix):",
      ...suggestions.map((s) => `- ${s}`),
    );
  }
  if (readOnly.length > 0) {
    lines.push(
      "",
      `A download from the Data Portal will FAIL: EPLAN can't write to the ${readOnly.join(", ")}.`,
      "Before queueing anything, tell the user to point those folders at ones they can write to",
      "(in EPLAN: File > Settings > User > Management > Directories), or to ask whoever manages them.",
    );
  }
  return lines.join("\n");
}
