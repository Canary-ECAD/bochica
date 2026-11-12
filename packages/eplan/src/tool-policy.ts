import { z } from "zod";

// How Bochica guards each eplan-mcp tool (guardrails layers 5 and 6). eplan-mcp states what each
// tool does (MCP annotations plus EPLAN facts in its `_meta`); Bochica decides the policy from
// them here. The facts are trusted because the version is pinned: fixtures/eplan-mcp-tools.json
// records them, so a bump shows every change. A tool without them asks and gets a backup.

export interface EplanToolPolicy {
  approval: "never" | "ask" | "always";
  /** Changes a project, so Bochica backs it up before the first such call in a session. */
  changesProject: boolean;
}

/** What an MCP client knows about a tool: its name, annotations and `_meta`, as listed. */
export interface EplanToolInfo {
  name: string;
  annotations?: unknown;
  meta?: unknown;
}

/** The `_meta` key under which eplan-mcp puts its EPLAN facts. */
export const EPLAN_META_KEY = "canary-ecad/eplan";

/** Every fact must be there: a tool that states only some of them is treated as unknown. */
const EplanFacts = z.object({
  changesProject: z.boolean(),
  runsCode: z.boolean(),
  changesEplan: z.boolean(),
  projectArgument: z.string().min(1).optional(),
});
export type EplanFacts = z.infer<typeof EplanFacts>;

/** The two hints the policy reads must be explicit: MCP's defaults are not facts. */
const Hints = z.object({ readOnlyHint: z.boolean(), destructiveHint: z.boolean() });

/** The tool's EPLAN facts, or null when it states none (or not all of them). */
export function eplanFacts(tool: EplanToolInfo): EplanFacts | null {
  const meta = z.record(z.string(), z.unknown()).safeParse(tool.meta);
  const facts = EplanFacts.safeParse(meta.success ? meta.data[EPLAN_META_KEY] : undefined);
  return facts.success ? facts.data : null;
}

/** What a tool without annotations gets: a new upstream tool is never silently read-only. */
const UNKNOWN: EplanToolPolicy = { approval: "ask", changesProject: true };

/**
 * The policy the facts give:
 * - read-only and changing nothing → never asks;
 * - destructive, running code or changing EPLAN itself → asks every time (`always`), even
 *   after "Allow for this session";
 * - anything else → asks.
 * Changing the project adds a backup.
 */
export function policyFromFacts(tool: EplanToolInfo): EplanToolPolicy {
  const hints = Hints.safeParse(tool.annotations);
  const facts = eplanFacts(tool);
  if (!hints.success || !facts) return UNKNOWN;
  const { readOnlyHint, destructiveHint } = hints.data;
  const strong = destructiveHint || facts.runsCode || facts.changesEplan;
  if (readOnlyHint && !strong && !facts.changesProject) {
    return { approval: "never", changesProject: false };
  }
  return { approval: strong ? "always" : "ask", changesProject: facts.changesProject };
}

/**
 * Tools where Bochica wants something other than what the facts give, each with its reason.
 * Keep it short: a fact that is wrong is fixed upstream, in eplan-mcp's tool_annotations.py.
 */
export const eplanOverrides: Readonly<Record<string, { policy: EplanToolPolicy; reason: string }>> =
  {
    eplan_lock_unlock_all_objects: {
      policy: { approval: "always", changesProject: true },
      reason:
        "Deprecated upstream and never verified; it acts on every object of the project at once.",
    },
    eplan_script_host_install: {
      policy: { approval: "always", changesProject: false },
      reason:
        "Downloads and installs a binary outside the pinned runtime. No mode offers it (modes.ts); if one ever does, it asks every time.",
    },
  };

export function eplanToolPolicy(tool: EplanToolInfo): EplanToolPolicy {
  return eplanOverrides[tool.name]?.policy ?? policyFromFacts(tool);
}
