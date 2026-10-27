import type { Confirmation } from "@bochica/shared";

// Guardrails layer 6: destructive EPLAN actions need the user to type a confirmation, every
// time. Destroying work must stay possible but never be one click away. This decides which
// calls need it and what the user must type.

const PROJECT_EXTENSION = /\.(elk|elp|els|elx|ell|elr|elt|ema|elm)$/i;
const PROJECT_ARGUMENTS = ["project_name", "project_path", "project", "PROJECT"];

/**
 * Words that make an arbitrary action or script destructive. Matched anywhere, so camel-case
 * action names (XPrjActionProjectDelete) count too; a false alarm only costs one typed word.
 */
const DESTRUCTIVE = /(delete|remove|purge|reorganize|discard|erase|destroy|wipe)/i;

/** Tools whose whole purpose is to delete or overwrite. */
const alwaysDestructive = new Set([
  "eplan_scratch_project_discard",
  "eplan_delete_device_list",
  "eplan_delete_representation_type",
  "eplan_remove_language",
  "eplan_restore_project",
  "eplan_restore_masterdata",
]);

/** Tools that run whatever they are given: destructive when their input says so. */
const runsAnything = new Set([
  "eplan_execute_raw_action",
  "eplan_action_run",
  "eplan_execute_script",
  "eplan_execute_custom_script",
]);

function field(input: unknown, name: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

/** The project's name when the call names one: what the user types to confirm. */
function byProjectName(input: unknown): Confirmation {
  for (const key of PROJECT_ARGUMENTS) {
    const path = field(input, key)?.trim();
    if (path && PROJECT_EXTENSION.test(path)) {
      const name = path.split(/[\\/]/).at(-1)?.replace(PROJECT_EXTENSION, "");
      if (name) return { type: "name", value: name };
    }
  }
  return { type: "word" };
}

/** What the user must type before this call runs, or null if it isn't destructive. */
export function eplanConfirmation(tool: string, input: unknown): Confirmation | null {
  if (tool === "eplan_project_management") {
    return field(input, "type")?.trim().toUpperCase() === "REORGANIZE"
      ? byProjectName(input)
      : null;
  }
  if (alwaysDestructive.has(tool)) return byProjectName(input);
  if (runsAnything.has(tool) && DESTRUCTIVE.test(JSON.stringify(input ?? {}))) {
    return byProjectName(input);
  }
  return null;
}
