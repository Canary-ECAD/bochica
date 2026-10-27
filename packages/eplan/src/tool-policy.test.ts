import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifiedEplanTools, eplanToolPolicy } from "./tool-policy";

// Tool names of the eplan-mcp commit pinned in components.lock.json. Regenerate this file when
// bumping eplan-mcp, then fix any failure below.
const pinnedTools = readFileSync(join(import.meta.dir, "fixtures", "eplan-mcp-tools.txt"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean);

/** Words that mean a tool changes something; a read tool must not contain any of them. */
const writeWords =
  /(^|_)(set|delete|remove|import|create|update|renumber|generate|execute|run|register|restore|rename|insert|place|unite|correct|translate|change|lock|upgrade|compress|convert|discard|shutdown|restart|launch)(_|$)/;

describe("eplan tool policy", () => {
  test("the fixture is the full pinned list", () => {
    expect(pinnedTools).toHaveLength(217);
  });

  test("every listed tool still exists upstream", () => {
    const stale = [...classifiedEplanTools].filter((t) => !pinnedTools.includes(t));
    expect(stale).toEqual([]);
  });

  test("no read tool has a name that suggests a change", () => {
    const suspicious = pinnedTools.filter(
      (t) => eplanToolPolicy(t).approval === "never" && writeWords.test(t),
    );
    expect(suspicious).toEqual([]);
  });

  test("unknown tools ask and get a backup", () => {
    expect(eplanToolPolicy("eplan_something_new")).toEqual({
      approval: "ask",
      changesProject: true,
    });
  });

  test.each([
    ["eplan_get_current_project", "never", false],
    ["eplan_search_devices", "never", false],
    ["eplan_export_pdf_project", "ask", false],
    ["eplan_open_project", "ask", false],
    ["eplan_set_project_property", "ask", true],
    ["eplan_renumber_devices", "ask", true],
    ["eplan_live_create_page", "ask", true],
    ["eplan_app_shutdown", "always", false],
    ["eplan_execute_script", "always", true],
    ["eplan_delete_device_list", "always", true],
    ["eplan_settings_set_bool", "always", false],
  ] as const)("%s → %s, backup %p", (tool, approval, changesProject) => {
    expect(eplanToolPolicy(tool)).toEqual({ approval, changesProject });
  });

  test("the guardrails' named cases always ask", () => {
    for (const tool of ["eplan_app_shutdown", "eplan_app_restart", "eplan_project_management"]) {
      expect(eplanToolPolicy(tool).approval).toBe("always");
    }
  });

  test("how the 217 tools split", () => {
    const counts = { never: 0, ask: 0, always: 0 };
    for (const tool of pinnedTools) counts[eplanToolPolicy(tool).approval]++;
    // A snapshot of the split, so a change to the lists is a deliberate, visible diff.
    expect(counts).toMatchInlineSnapshot(`
      {
        "always": 40,
        "ask": 120,
        "never": 57,
      }
    `);
  });
});
