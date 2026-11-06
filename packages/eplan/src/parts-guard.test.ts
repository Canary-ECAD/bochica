import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eplanBlock } from "./parts-guard";

const dir = mkdtempSync(join(tmpdir(), "bochica-guard-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const removing = join(dir, "remove.cs");
writeFileSync(removing, "var db = new MDPartsManagement().OpenDatabase();\ndb.RemovePart(part);\n");
const harmless = join(dir, "read.cs");
writeFileSync(harmless, "// db.RemovePart(part) would be wrong\nvar n = db.Parts.Length;\n");

describe("eplanBlock", () => {
  test.each([
    [
      "custom code removing a part",
      "eplan_execute_custom_script",
      { script_code: "db.RemovePart(p);" },
    ],
    [
      "custom code removing the database",
      "eplan_execute_custom_script",
      { script_code: "mgmt.RemoveDatabase (db)" },
    ],
    [
      "custom code removing a manufacturer",
      "eplan_execute_custom_script",
      { script_code: "db.RemoveManufacturer(m);" },
    ],
    ["a script file removing parts", "eplan_execute_script", { script_file: removing }],
    ["registering a script that removes parts", "eplan_register_script", { script_file: removing }],
  ] as const)("blocks %s", (_case, tool, input) => {
    expect(eplanBlock({ name: tool }, input)).toMatchObject({ block: "parts-remove" });
  });

  test.each([
    [
      "custom code that reads",
      "eplan_execute_custom_script",
      { script_code: 'var p = db.GetPart("A");' },
    ],
    ["removal only in a comment", "eplan_execute_script", { script_file: harmless }],
    ["a missing script file", "eplan_execute_script", { script_file: join(dir, "missing.cs") }],
    [
      "removing a function template position, not a part",
      "eplan_execute_custom_script",
      { script_code: "part.RemoveFunctionTemplatePosition(x);" },
    ],
    ["another tool", "eplan_parts_db_update", { part_number: "RemovePart(" }],
  ] as const)("allows %s", (_case, tool, input) => {
    expect(eplanBlock({ name: tool }, input)).toBeNull();
  });
});
