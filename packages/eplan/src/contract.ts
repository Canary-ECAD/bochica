import { z } from "zod";
import { EPLAN_META_KEY, type EplanToolInfo, eplanToolPolicy } from "./tool-policy";

// The tool contract of the pinned eplan-mcp, as fixtures/eplan-mcp-tools.json records it: every
// tool with its MCP annotations and EPLAN facts. Same shape as the tools.json eplan-mcp attaches to
// its releases. prepare-runtime --lock writes it from what the bundled server lists, the bump
// prints how it changed, and the policy tests read it.

const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const;

const ContractTool = z.object({
  name: z.string(),
  annotations: z.record(z.string(), z.boolean().nullable()),
  facts: z.record(z.string(), z.unknown()).nullable(),
});
export const ToolContract = z.object({ mode: z.string(), tools: z.array(ContractTool) });
export type ToolContract = z.infer<typeof ToolContract>;
type ContractTool = z.infer<typeof ContractTool>;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** The contract for what a server listed: the four hints always present, sorted by name. */
export function toolContract(tools: readonly EplanToolInfo[]): ToolContract {
  return {
    mode: "full",
    tools: tools
      .map((tool) => {
        const annotations = record(tool.annotations);
        const facts = record(tool.meta)[EPLAN_META_KEY];
        return {
          name: tool.name,
          annotations: Object.fromEntries(
            HINTS.map((key) => {
              const value = annotations[key];
              return [key, typeof value === "boolean" ? value : null];
            }),
          ),
          facts: typeof facts === "object" && facts !== null ? record(facts) : null,
        };
      })
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Back to what the policy reads: annotations and `_meta` as the server sent them. */
export function contractTools(contract: ToolContract): EplanToolInfo[] {
  return contract.tools.map((tool) => ({
    name: tool.name,
    annotations: Object.fromEntries(
      Object.entries(tool.annotations).filter(([, value]) => value !== null),
    ),
    ...(tool.facts ? { meta: { [EPLAN_META_KEY]: tool.facts } } : {}),
  }));
}

export interface ContractChanges {
  added: string[];
  removed: string[];
  /** Tools whose annotations or facts changed, each with what changed. */
  reannotated: Array<{ name: string; changes: string[] }>;
  /** Tools that used to ask (or back up) and now never do: the bump warns for each. */
  nowReadOnly: string[];
}

function differences(before: ContractTool, after: ContractTool): string[] {
  const out: string[] = [];
  for (const group of ["annotations", "facts"] as const) {
    const a = record(before[group]);
    const b = record(after[group]);
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].toSorted()) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        out.push(`${key} ${JSON.stringify(a[key] ?? null)} → ${JSON.stringify(b[key] ?? null)}`);
      }
    }
  }
  return out;
}

const toolMap = (contract: ToolContract) =>
  new Map(contractTools(contract).map((tool) => [tool.name, tool]));

const approval = (tools: Map<string, EplanToolInfo>, name: string) =>
  eplanToolPolicy(tools.get(name) ?? { name }).approval;

/** How the contract changed between two pinned versions. */
export function contractChanges(before: ToolContract, after: ToolContract): ContractChanges {
  const old = new Map(before.tools.map((t) => [t.name, t]));
  const now = new Map(after.tools.map((t) => [t.name, t]));
  const [oldInfo, newInfo] = [toolMap(before), toolMap(after)];
  const reannotated = [...now.values()].flatMap((tool) => {
    const previous = old.get(tool.name);
    const changes = previous ? differences(previous, tool) : [];
    return changes.length > 0 ? [{ name: tool.name, changes }] : [];
  });
  return {
    added: [...now.keys()].filter((name) => !old.has(name)),
    removed: [...old.keys()].filter((name) => !now.has(name)),
    reannotated,
    nowReadOnly: reannotated
      .map((t) => t.name)
      .filter((name) => approval(oldInfo, name) !== "never" && approval(newInfo, name) === "never"),
  };
}
