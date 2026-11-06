import { readFileSync, statSync } from "node:fs";
import type { EplanToolInfo } from "./tool-policy";

// Guardrails layer 1 for the parts database: an EPLAN script that removes parts, manufacturers
// or a whole parts database is refused in every mode, and no card can allow it. A parts database
// is shared by a whole team and has no undo; removing parts on purpose is a job for EPLAN's own
// parts management, by hand.

/** EPLAN API calls (Eplan.EplApi.MasterData) that remove master data from the parts database. */
const PARTS_REMOVAL =
  /\b(RemovePart|RemoveDatabase|RemoveManufacturer|RemoveCustomer|RemoveAllTranslations)\s*\(/;

/** Scripts larger than this are not read; they are refused, since they can't be checked. */
const MAX_SCRIPT_BYTES = 2_000_000;

function field(input: unknown, name: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

/** The C# a call would run: its code, or the file it names. */
function scriptOf(tool: string, input: unknown): string | null | undefined {
  if (tool === "eplan_execute_custom_script") return field(input, "script_code") ?? "";
  if (tool !== "eplan_execute_script" && tool !== "eplan_register_script") return undefined;
  const path = field(input, "script_file");
  if (!path) return "";
  try {
    if (statSync(path).size > MAX_SCRIPT_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    // EPLAN will say the file is missing; nothing of it can run.
    return "";
  }
}

export interface EplanBlock {
  block: string;
  reason: string;
}

/** Why Bochica refuses this EPLAN call outright, or null when it may go on to its card. */
export function eplanBlock(tool: EplanToolInfo, input: unknown): EplanBlock | null {
  const script = scriptOf(tool.name, input);
  if (script === undefined) return null;
  if (script === null) {
    return {
      block: "parts-remove",
      reason: "the script file is too large for Bochica to check what it does.",
    };
  }
  const match = PARTS_REMOVAL.exec(script.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""));
  if (!match) return null;
  return {
    block: "parts-remove",
    reason: `the script calls ${match[1]}, which removes data from the parts database. Bochica never removes parts, manufacturers or parts databases; the user can do that in EPLAN's parts management.`,
  };
}
