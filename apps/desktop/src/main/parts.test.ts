import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@bochica/agent";
import { type Fetch, parsePartsDocument, type PartsDocument, updateDocument } from "@bochica/eplan";
import { type CallEplan, macroValue, parseChanges, PartsService } from "./parts";

const sample = join(import.meta.dir, "../../../../packages/eplan/src/fixtures/parts-sample.xml");
const signal = new AbortController().signal;
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bochica-parts-"));
  dirs.push(dir);
  return dir;
}

/** A made-up EPLAN: a parts database in memory that exports and imports like the real one. */
function fakeEplan(
  options: {
    macros?: string;
    folders?: Record<string, string>;
    sabotage?: boolean;
    /** What the import answers instead of importing: a timeout, or a thrown error. */
    importFails?: "timeout" | "throw";
  } = {},
) {
  let db: PartsDocument = parsePartsDocument(readFileSync(sample, "utf8"));
  const calls: string[] = [];
  const call: CallEplan = async (tool, args) => {
    calls.push(tool);
    if (tool === "eplan_partsmanagement_export") {
      const wanted = args["part_numbers"] as string[];
      const all = wanted.includes("*");
      const selected = new Map(
        db.parts
          .filter((p) => all || wanted.includes(p.record.partNumber))
          .map((p) => [p.record.partNumber, {}]),
      );
      writeFileSync(`${String(args["export_file"])}.xml`, updateDocument(db, selected));
      return { ok: true, text: JSON.stringify({ success: true }) };
    }
    if (tool === "eplan_partsmanagement_import") {
      expect(args["mode"]).toBe(1);
      if (options.importFails === "throw") throw new Error("The eplan server is not connected.");
      if (options.importFails === "timeout") {
        return {
          ok: true,
          text: JSON.stringify({
            success: false,
            error_type: "EplanActionTimeout",
            timed_out: true,
            message: "EPLAN did not finish this call within 600s.",
          }),
        };
      }
      const incoming = parsePartsDocument(readFileSync(String(args["import_file"]), "utf8"));
      db = {
        root: db.root,
        parts: db.parts.map((part) => {
          const next = incoming.parts.find((p) => p.record.partNumber === part.record.partNumber);
          if (!next) return part;
          const raw = options.sabotage
            ? next.raw.replace(/P_ARTICLE_PICTUREFILE="[^"]*"/, 'P_ARTICLE_PICTUREFILE="lost"')
            : next.raw;
          const [parsed] = parsePartsDocument(`<partsmanagement>${raw}</partsmanagement>`).parts;
          return parsed ? { raw, record: parsed.record } : part;
        }),
      };
      return { ok: true, text: JSON.stringify({ success: true }) };
    }
    if (tool === "eplan_parts_db_count") {
      return {
        ok: true,
        text: JSON.stringify({ success: true, results: { count: db.parts.length } }),
      };
    }
    if (tool === "eplan_pathmap_substitute") {
      const variable = String(args["path_with_variables"]);
      const folder = options.folders?.[variable] ?? options.macros;
      return folder
        ? {
            ok: true,
            text: JSON.stringify({ success: true, results: { substituted: folder } }),
          }
        : { ok: false, text: "not connected" };
    }
    throw new Error(`unexpected tool ${tool}`);
  };
  return { call, calls, db: () => db };
}

function service(
  eplan: ReturnType<typeof fakeEplan>,
  fetch: Fetch = async () => new Response("", { status: 500 }),
) {
  const root = tempDir();
  const folder = join(root, "work");
  const parts = new PartsService({
    call: eplan.call,
    workRoot: join(root, "parts"),
    backupRoot: join(root, "backups"),
    fetch,
  });
  const tools = parts.tools({ sessionId: "s1", folder, language: "es" });
  const tool = (name: string) => tools.find((t) => t.tool === name) as AgentTool;
  return { tool, folder, backups: join(root, "backups"), root };
}

const fix = (changes: Array<{ partNumber: string; field: string; value: string }>) => ({ changes });

describe("parts_report", () => {
  test("exports, checks every rule, writes the CSV and returns the card", async () => {
    const eplan = fakeEplan();
    const { tool, folder } = service(eplan);
    const result = await tool("parts_report").execute({}, signal);
    expect(result.ok).toBe(true);
    expect(result.card?.total).toBe(5);
    expect(result.card?.rules.find((r) => r.id === "erp-number")?.count).toBe(1);
    expect(existsSync(result.card?.csv ?? "")).toBe(true);
    expect(readdirSync(folder).some((f) => f.startsWith("parts-report-"))).toBe(true);
    expect(result.text).toContain("Checked 5 parts");
    expect(tool("parts_report").approval).toBe("never");
  });
});

describe("parts_fix", () => {
  test("invalid batches are refused before anyone is asked", () => {
    expect(parseChanges({ changes: [] })).toContain("at least one");
    expect(parseChanges(fix([{ partNumber: "A", field: "partNumber", value: "B" }]))).toContain(
      "Unknown field",
    );
    expect(parseChanges(fix([{ partNumber: "A", field: "erp", value: " " }]))).toContain("empty");
    const many = Array.from({ length: 101 }, (_, i) => ({
      partNumber: `P${i}`,
      field: "erp",
      value: "1",
    }));
    expect(parseChanges(fix(many))).toContain("at most 100");
    const { tool } = service(fakeEplan());
    expect(tool("parts_fix").assess?.({ changes: [] })).toMatchObject({ block: "parts-invalid" });
  });

  test("the preview shows current and new values; the batch changes only them", async () => {
    const eplan = fakeEplan();
    const { tool, backups } = service(eplan);
    const input = fix([
      { partNumber: "DEMO.CT-200", field: "erp", value: "100002" },
      { partNumber: "DEMO.CT-200", field: "description", value: "Contactor nuevo" },
      { partNumber: "DEMO.TB-10", field: "manufacturer", value: "DEMO" },
    ]);
    const preview = await tool("parts_fix").preview?.(input, signal);
    expect(preview).toMatchObject({
      kind: "parts-fix",
      parts: 2,
      rows: [
        { partNumber: "DEMO.CT-200", field: "erp", current: "", value: "100002" },
        { partNumber: "DEMO.CT-200", field: "description", current: "", value: "Contactor nuevo" },
        { partNumber: "DEMO.TB-10", field: "manufacturer", current: "", value: "DEMO" },
      ],
    });
    const result = await tool("parts_fix").execute(input, signal);
    expect(result.text).toContain("the check passed");
    expect(result.ok).toBe(true);
    const part = eplan.db().parts.find((p) => p.record.partNumber === "DEMO.CT-200")?.record;
    expect(part?.properties["P_ARTICLE_ERPNR"]).toBe("100002");
    // Written in the user's language.
    expect(part?.properties["P_ARTICLE_NOTE"]).toBe("es_ES@Contactor nuevo;");

    // A second batch in the same session: still one backup.
    const second = await tool("parts_fix").execute(
      fix([{ partNumber: "DEMO.TB-10", field: "erp", value: "200011" }]),
      signal,
    );
    expect(second.ok).toBe(true);
    expect(readdirSync(backups).filter((f) => f.endsWith(".xml"))).toHaveLength(1);
    expect(eplan.calls.filter((c) => c === "eplan_partsmanagement_import")).toHaveLength(2);
  });

  test("a description keeps the other languages", async () => {
    const eplan = fakeEplan();
    const { tool } = service(eplan);
    await tool("parts_fix").execute(
      fix([{ partNumber: "DEMO.CT-100", field: "description", value: "Contactor 3 kW" }]),
      signal,
    );
    const part = eplan.db().parts.find((p) => p.record.partNumber === "DEMO.CT-100")?.record;
    expect(part?.properties["P_ARTICLE_NOTE"]).toBe(
      "??_??@Contactor 3 kW & 1 NO;es_ES@Contactor 3 kW;",
    );
  });

  test("parts not in the database: nothing is imported", async () => {
    const eplan = fakeEplan();
    const { tool } = service(eplan);
    const result = await tool("parts_fix").execute(
      fix([{ partNumber: "DEMO.NOPE", field: "erp", value: "1" }]),
      signal,
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain("DEMO.NOPE");
    expect(eplan.calls).not.toContain("eplan_partsmanagement_import");
  });

  test.each([
    ["times out", "timeout", "not known which parts changed"],
    ["throws", "throw", "some parts may have changed"],
  ] as const)("an import that %s stops further batches", async (_case, importFails, says) => {
    const { tool } = service(fakeEplan({ importFails }));
    const batch = fix([{ partNumber: "DEMO.CT-200", field: "erp", value: "100002" }]);
    const result = await tool("parts_fix").execute(batch, signal);
    expect(result.ok).toBe(false);
    expect(result.text).toContain(says);
    expect(result.text).toContain("Run parts_report with these part numbers");
    expect(tool("parts_fix").assess?.(batch)).toMatchObject({ block: "parts-halted" });
  });

  test("a failed smoke test stops further batches in the session", async () => {
    const eplan = fakeEplan({ sabotage: true });
    const { tool } = service(eplan);
    const result = await tool("parts_fix").execute(
      fix([{ partNumber: "DEMO.CT-200", field: "erp", value: "100002" }]),
      signal,
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain("check FAILED");
    expect(result.text).toContain(
      "P_ARTICLE_PICTUREFILE changed although the batch didn't touch it",
    );
    expect(
      tool("parts_fix").assess?.(fix([{ partNumber: "DEMO.TB-10", field: "erp", value: "1" }])),
    ).toMatchObject({
      block: "parts-halted",
    });
  });
});

const portal: Fetch = async (url, init) => {
  if (url.endsWith("/partscheck")) {
    const data = String(init?.body)
      .split("\n")
      .map((search) =>
        search === "DEMO.CT-200" || search === "DEMO.TB-10"
          ? {
              type: "partscheckresult",
              attributes: {
                search,
                partid: search.length,
                partnr: search,
                data_supplier: "DEMO",
              },
            }
          : { type: "partscheckmissingresult", attributes: { search } },
      );
    return Response.json({ data });
  }
  const id = Number(url.split("/").at(-1));
  return Response.json({
    data: {
      id: String(id),
      attributes: {
        part_number: id === 11 ? "DEMO.CT-200" : "DEMO.TB-10",
        description: { en_US: "Contactor", es_ES: "Contactor ES" },
        data_supplier: "DEMO",
        group_symbol_macro_path: id === 11 ? "Demo\\CT-200.ema" : "Demo\\TB-10.ema",
      },
    },
  });
};

describe("parts_lookup", () => {
  test("suggests descriptions in the user's language and macros found on disk", async () => {
    const macros = tempDir();
    mkdirSync(join(macros, "Demo"));
    writeFileSync(join(macros, "Demo", "CT-200.ema"), "");
    const eplan = fakeEplan({ macros });
    const { tool } = service(eplan, portal);
    const result = await tool("parts_lookup").execute(
      { partNumbers: ["DEMO.CT-200", "DEMO.TB-10", "DEMO.NOPE"] },
      signal,
    );
    expect(result.ok).toBe(true);
    expect(result.text).toContain('DEMO.CT-200 description: "Contactor ES"');
    expect(result.text).toContain(`DEMO.CT-200 schematicMacro: ${macroValue("Demo\\CT-200.ema")}`);
    expect(result.text).toContain("DEMO.TB-10 schematic macro: not in the macros folder yet");
    expect(result.text).toContain("dataportal_id 10");
    expect(result.text).toContain("DEMO.TB-10 manufacturer: DEMO");
    expect(result.text).toContain("DEMO.NOPE: not on the Data Portal");
  });

  test("a read-only master data folder is reported before anything is queued", async () => {
    const macros = tempDir();
    const eplan = fakeEplan({
      macros,
      // A pictures folder that can't be written to (here: one that doesn't exist).
      folders: { "$(MD_IMG)": join(macros, "missing", "pictures") },
    });
    const { tool } = service(eplan, portal);
    const result = await tool("parts_lookup").execute({ partNumbers: ["DEMO.TB-10"] }, signal);
    expect(result.text).toContain("A download from the Data Portal will FAIL");
    expect(result.text).toContain(`pictures folder ${join(macros, "missing", "pictures")}`);
    // The macros folder is writable, so it isn't listed.
    expect(result.text).not.toContain(`macros folder ${macros}`);
    // The check leaves nothing behind.
    expect(readdirSync(macros)).toEqual([]);
  });

  test("no download needed: the folders aren't checked", async () => {
    const macros = tempDir();
    mkdirSync(join(macros, "Demo"));
    writeFileSync(join(macros, "Demo", "CT-200.ema"), "");
    const eplan = fakeEplan({ macros, folders: { "$(MD_IMG)": join(macros, "missing") } });
    const { tool } = service(eplan, portal);
    const result = await tool("parts_lookup").execute({ partNumbers: ["DEMO.CT-200"] }, signal);
    expect(result.text).not.toContain("will FAIL");
  });

  test("the portal being down is a sentence, not a crash", async () => {
    const { tool } = service(fakeEplan(), async () => new Response("", { status: 503 }));
    const result = await tool("parts_lookup").execute({ partNumbers: ["DEMO.CT-200"] }, signal);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("answered 503");
  });

  test("macro paths are stored relative to $(MD_MACROS)", () => {
    expect(macroValue("Demo/CT-100.ema")).toBe("$(MD_MACROS)\\Demo\\CT-100.ema");
  });
});
