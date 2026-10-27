import type { Confirmation, FileDiff, ToolStatus } from "@bochica/shared";
import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import { redactSecrets } from "./redact";

/** A tool the agent can call, whatever its source (MCP server or built-in). */
export interface AgentTool {
  /** Name the model sees: letters, digits, `_` and `-`, at most 64 characters. */
  name: string;
  /** MCP server id, or "bochica" for built-in tools. */
  server: string;
  /** The tool's own name on its server. */
  tool: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * Guardrails layer 5. "never": read-only, runs straight away. "ask": waits for the user, who
   * may allow it for the rest of the session. "always": waits for the user every time.
   */
  approval: ToolApproval;
  /** Changes an EPLAN project, so a backup must exist first (see the desktop BackupGuard). */
  changesProject?: boolean;
  /**
   * Guardrails layer 6: for a destructive call, what the user must type before it runs. When
   * this returns something, the call asks every time, whatever `approval` says.
   */
  confirmation?: (input: unknown) => Confirmation | null;
  /**
   * Guardrails layers 1, 2, 4 and 5 for this one call, before anyone is asked: refuse it, or
   * make it ask every time and say why.
   */
  assess?: (input: unknown) => Assessment;
  execute(input: unknown, signal: AbortSignal): Promise<ToolRunResult>;
}

export interface ToolRunResult {
  ok: boolean;
  text: string;
  diff?: FileDiff;
}

export type ToolApproval = "never" | "ask" | "always";

export type Assessment =
  /** Refused. `code` is for the UI ("system-delete"); `reason` tells the model why. */
  | { block: string; reason: string }
  /** Allowed to ask; `risks` make it ask every time and are listed on the card. */
  | { risks: string[] };

export type ApprovalAnswer = "allow" | "deny";

export type Approver = (call: {
  callId: string;
  server: string;
  tool: string;
  input: unknown;
  approval: Exclude<ToolApproval, "never">;
  confirm?: Confirmation;
  risks?: string[];
}) => Promise<ApprovalAnswer>;

/** What a tool call produced, as the loop and the UI see it. */
export interface ToolOutcome {
  status: ToolStatus;
  text: string;
  blocked?: string;
  diff?: FileDiff;
}

/** Longest tool output sent to the model; longer output is cut with a note. */
const MODEL_OUTPUT_LIMIT = 20_000;
/** Longest tool output shown in the activity log. */
export const DISPLAY_OUTPUT_LIMIT = 2_000;

export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[… ${text.length - limit} more characters not shown]`;
}

export function qualifiedName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

/**
 * Runs one call the way the model's calls run: assessment, approval, then redaction and
 * truncation. Without `approve`, anything that would ask is denied.
 */
export async function runTool(
  tool: AgentTool,
  input: unknown,
  {
    callId,
    approve,
    signal,
  }: { callId: string; approve: Approver | undefined; signal: AbortSignal },
): Promise<ToolOutcome> {
  const assessment = tool.assess?.(input) ?? { risks: [] };
  if ("block" in assessment) {
    return {
      status: "blocked",
      blocked: assessment.block,
      text: `Bochica blocked this action: ${assessment.reason} Do not retry it, and do not try to get the same result another way. Tell the user it was blocked and why.`,
    };
  }
  const { risks } = assessment;
  const confirm = tool.confirmation?.(input) ?? undefined;
  if (confirm || risks.length > 0 || tool.approval !== "never") {
    // Destructive and risky calls ask every time, even on an otherwise read-only tool.
    const approval =
      confirm || risks.length > 0 || tool.approval === "never" ? "always" : tool.approval;
    const answer = approve
      ? await approve({
          callId,
          server: tool.server,
          tool: tool.tool,
          input,
          approval,
          ...(confirm ? { confirm } : {}),
          ...(risks.length > 0 ? { risks } : {}),
        })
      : "deny";
    if (answer === "deny") {
      return {
        status: "denied",
        text: "The user did not allow this action. Do not retry it; ask the user how to continue.",
      };
    }
  }
  try {
    const result = await tool.execute(input, signal);
    return {
      status: result.ok ? "ok" : "error",
      text: truncate(redactSecrets(result.text), MODEL_OUTPUT_LIMIT),
      ...(result.diff ? { diff: { ...result.diff, patch: redactSecrets(result.diff.patch) } } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", text: redactSecrets(message) };
  }
}

/** Wraps agent tools for the AI SDK: approval first, then redaction and truncation. */
export function toToolSet(tools: AgentTool[], approve: Approver | undefined): ToolSet {
  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      dynamicTool({
        description: tool.description,
        inputSchema: jsonSchema(tool.inputSchema),
        execute: (input, { abortSignal, toolCallId }): Promise<ToolOutcome> =>
          runTool(tool, input, {
            callId: toolCallId,
            approve,
            signal: abortSignal ?? new AbortController().signal,
          }),
        toModelOutput: ({ output }) => ({ type: "text", value: (output as ToolOutcome).text }),
      }),
    ]),
  );
}
