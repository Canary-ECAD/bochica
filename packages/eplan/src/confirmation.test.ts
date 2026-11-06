import { describe, expect, test } from "bun:test";
import { confirmationMatches } from "@bochica/shared";
import { eplanConfirmation } from "./confirmation";
import { EPLAN_META_KEY } from "./tool-policy";

// Made-up project paths.
const demo = "C:\\Projects\\Demo.elk";

describe("eplanConfirmation", () => {
  test.each([
    [
      "REORGANIZE purges for good",
      "eplan_project_management",
      { type: "REORGANIZE", project_name: demo },
      { type: "name", value: "Demo" },
    ],
    [
      "lower-case type too",
      "eplan_project_management",
      { type: " reorganize ", project_name: demo },
      { type: "name", value: "Demo" },
    ],
    [
      "discarding a scratch project",
      "eplan_scratch_project_discard",
      { project_path: "C:\\Temp\\eplan_mcp_scratch\\T_scratch.elk" },
      { type: "name", value: "T_scratch" },
    ],
    [
      "deleting the device list",
      "eplan_delete_device_list",
      { project_name: demo },
      { type: "name", value: "Demo" },
    ],
    [
      "removing a language",
      "eplan_remove_language",
      { project_name: demo, language: "de_DE" },
      { type: "name", value: "Demo" },
    ],
    [
      "restoring without a project name",
      "eplan_restore_project",
      { archive_name: "C:\\Backups\\Demo.zw1" },
      { type: "word" },
    ],
    [
      "a raw action that deletes",
      "eplan_execute_raw_action",
      { action: "XPrjActionProjectDelete" },
      { type: "word" },
    ],
    [
      "a script that removes pages",
      "eplan_execute_script",
      { code: "page.Remove();" },
      { type: "word" },
    ],
    [
      "an action run against a project",
      "eplan_run_project_action",
      { action: "XPrjActionProjectDelete", project_name: demo },
      { type: "name", value: "Demo" },
    ],
    [
      "a catalog action with a purge",
      "eplan_action_run",
      { action_id: "PurgeUnusedData", project_name: demo },
      { type: "name", value: "Demo" },
    ],
    [
      "an import that replaces parts",
      "eplan_partsmanagement_import",
      { import_file: "C:\\Work\\parts.xml", mode: 3 },
      { type: "word" },
    ],
    [
      "switching the parts database",
      "eplan_set_parts_data_source",
      { data_source: "1" },
      { type: "word" },
    ],
    [
      "restoring master data",
      "eplan_restore_masterdata",
      { archive: "C:\\Backups\\parts.zw9" },
      { type: "word" },
    ],
  ] as const)("%s", (_case, tool, input, expected) => {
    expect(eplanConfirmation({ name: tool }, input)).toEqual(expected);
  });

  test("the tool's projectArgument is read first", () => {
    const meta = {
      [EPLAN_META_KEY]: {
        changesProject: true,
        runsCode: false,
        changesEplan: false,
        projectArgument: "project_path",
      },
    };
    const input = { project_name: "C:\\Projects\\Other.elk", project_path: demo };
    expect(eplanConfirmation({ name: "eplan_delete_device_list", meta }, input)).toEqual({
      type: "name",
      value: "Demo",
    });
    // Without the fact, the usual order applies.
    expect(eplanConfirmation({ name: "eplan_delete_device_list" }, input)).toEqual({
      type: "name",
      value: "Other",
    });
  });

  test.each([
    [
      "other project management types",
      "eplan_project_management",
      { type: "CREATESNAPSHOTCOPY", project_name: demo },
    ],
    ["a harmless raw action", "eplan_execute_raw_action", { action: "XGedRedraw" }],
    ["a harmless script", "eplan_execute_script", { code: 'MessageBox.Show("hi");' }],
    ["setting a property", "eplan_set_project_property", { project_name: demo, value: "removed?" }],
    ["reading", "eplan_get_current_project", {}],
    ["exports", "eplan_export_pdf_project", { project_name: demo }],
    ["an import that updates", "eplan_partsmanagement_import", { import_file: "x.xml", mode: 1 }],
    ["an import that appends", "eplan_partsmanagement_import", { import_file: "x.xml" }],
  ] as const)("not for %s", (_case, tool, input) => {
    expect(eplanConfirmation({ name: tool }, input)).toBeNull();
  });
});

describe("confirmationMatches", () => {
  test("a name must match exactly (spaces around are fine)", () => {
    const confirm = { type: "name", value: "Demo" } as const;
    expect(confirmationMatches(confirm, " Demo ")).toBe(true);
    expect(confirmationMatches(confirm, "demo")).toBe(false);
    expect(confirmationMatches(confirm, "Demo2")).toBe(false);
    expect(confirmationMatches(confirm, "")).toBe(false);
  });

  test("the word works in English and Spanish, any case", () => {
    const confirm = { type: "word" } as const;
    for (const typed of ["DELETE", "delete", "Eliminar", " ELIMINAR "]) {
      expect(confirmationMatches(confirm, typed)).toBe(true);
    }
    for (const typed of ["yes", "DELET", "borrar", ""]) {
      expect(confirmationMatches(confirm, typed)).toBe(false);
    }
  });
});
