import { randomUUID } from "node:crypto";
import type { AgentTool, Approver } from "./tools";

// A model that runs the tools itself (Claude Agent: Claude Code drives the round-trips) still has
// to run Bochica's tools the way the loop does, with the approver of the turn that called it. The
// loop registers its tools here for the duration of a turn and names them in the call's
// `providerOptions`; such a model looks them up. Other providers ignore the option.

const TURN_TOOLS_OPTION = "bochica";

export interface TurnTools {
  tools: ReadonlyMap<string, AgentTool>;
  approve: Approver | undefined;
}

const registered = new Map<string, TurnTools>();

/** Registers a turn's tools; the returned options go on every model call of that turn. */
export function registerTurnTools(
  tools: AgentTool[],
  approve: Approver | undefined,
): { providerOptions: Record<string, { turnTools: string }>; release(): void } {
  const id = randomUUID();
  registered.set(id, { tools: new Map(tools.map((tool) => [tool.name, tool])), approve });
  return {
    providerOptions: { [TURN_TOOLS_OPTION]: { turnTools: id } },
    release: () => registered.delete(id),
  };
}

/** The tools of the turn that made a model call, from its `providerOptions`. */
export function turnToolsFor(
  providerOptions: Record<string, Record<string, unknown>> | undefined,
): TurnTools | undefined {
  const id = providerOptions?.[TURN_TOOLS_OPTION]?.["turnTools"];
  return typeof id === "string" ? registered.get(id) : undefined;
}
