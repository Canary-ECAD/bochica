import type { Confirmation } from "@bochica/shared";
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
  execute(input: unknown, signal: AbortSignal): Promise<{ ok: boolean; text: string }>;
}

export type ToolApproval = "never" | "ask" | "always";

export type ApprovalAnswer = "allow" | "deny";

export type Approver = (call: {
  callId: string;
  server: string;
  tool: string;
  input: unknown;
  approval: Exclude<ToolApproval, "never">;
  confirm?: Confirmation;
}) => Promise<ApprovalAnswer>;

/** What a tool call produced, as the loop and the UI see it. */
export interface ToolOutcome {
  status: "ok" | "error" | "denied";
  text: string;
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

/** Wraps agent tools for the AI SDK: approval first, then redaction and truncation. */
export function toToolSet(tools: AgentTool[], approve: Approver | undefined): ToolSet {
  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      dynamicTool({
        description: tool.description,
        inputSchema: jsonSchema(tool.inputSchema),
        execute: async (input, { abortSignal, toolCallId }): Promise<ToolOutcome> => {
          const confirm = tool.confirmation?.(input) ?? undefined;
          if (confirm || tool.approval !== "never") {
            const answer = approve
              ? await approve({
                  callId: toolCallId,
                  server: tool.server,
                  tool: tool.tool,
                  input,
                  // Destructive calls ask every time, even on an otherwise read-only tool.
                  approval: confirm || tool.approval === "never" ? "always" : tool.approval,
                  ...(confirm ? { confirm } : {}),
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
            const result = await tool.execute(input, abortSignal ?? new AbortController().signal);
            return {
              status: result.ok ? "ok" : "error",
              text: truncate(redactSecrets(result.text), MODEL_OUTPUT_LIMIT),
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { status: "error", text: redactSecrets(message) };
          }
        },
        toModelOutput: ({ output }) => ({ type: "text", value: (output as ToolOutcome).text }),
      }),
    ]),
  );
}
