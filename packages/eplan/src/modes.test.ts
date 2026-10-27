import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eplanToolInMode, modeListedTools } from "./modes";
import { eplanToolPolicy } from "./tool-policy";

const pinnedTools = readFileSync(join(import.meta.dir, "fixtures", "eplan-mcp-tools.txt"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean);

const toolsIn = (mode: "consult" | "tasks" | "draw") =>
  pinnedTools.filter((tool) => eplanToolInMode(tool, mode));

describe("tools per mode", () => {
  test("every listed tool exists upstream", () => {
    expect([...modeListedTools].filter((t) => !pinnedTools.includes(t))).toEqual([]);
  });

  test("Consult gets no EPLAN tool", () => {
    expect(toolsIn("consult")).toEqual([]);
  });

  test("Tasks gets no placement tool, and everything else", () => {
    const tasks = toolsIn("tasks");
    expect(tasks).not.toContain("eplan_live_place_symbol");
    expect(tasks).not.toContain("eplan_live_create_page");
    expect(tasks).toContain("eplan_set_project_property");
    expect(tasks).toContain("eplan_live_set_function_text");
  });

  test("Draw gets the placement tools", () => {
    const draw = toolsIn("draw");
    for (const tool of [
      "eplan_live_create_page",
      "eplan_live_place_symbol",
      "eplan_live_connect_pins",
    ]) {
      expect(draw).toContain(tool);
    }
  });

  test("Draw changes nothing project-wide: every change it can make is a drawing tool", () => {
    const writers = toolsIn("draw").filter((t) => eplanToolPolicy(t).approval !== "never");
    for (const tool of writers)
      expect(
        tool.startsWith("eplan_live_") ||
          tool.startsWith("eplan_insert_") ||
          tool === "eplan_start_ged_interaction",
      ).toBe(true);
    expect(toolsIn("draw")).not.toContain("eplan_project_management");
    expect(toolsIn("draw")).not.toContain("eplan_app_shutdown");
  });
});
