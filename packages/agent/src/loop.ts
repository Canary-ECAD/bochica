import type { ChatErrorCode, ChatMessage, TurnEvent } from "@bochica/shared";
import { APICallError, type LanguageModel, RetryError, stepCountIs, streamText } from "ai";
import { systemPrompt } from "./prompts";
import { redactSecrets } from "./redact";
import {
  type AgentTool,
  type Approver,
  DISPLAY_OUTPUT_LIMIT,
  type ToolOutcome,
  toToolSet,
  truncate,
} from "./tools";

/** Model calls per turn; each tool round-trip uses one. */
const DEFAULT_MAX_STEPS = 12;

export interface TurnOptions {
  model: LanguageModel;
  messages: ChatMessage[];
  abortSignal: AbortSignal;
  /** The system prompt; see systemPrompt(mode). */
  system?: string;
  tools?: AgentTool[];
  /** Asked before any tool with `needsApproval` runs. Without it, such calls are denied. */
  approve?: Approver;
  maxSteps?: number;
}

/**
 * Runs one assistant turn and yields its events. Never throws: failures become an `error`
 * event with a code the UI can explain, and the last event is always `turn-end` or `error`.
 */
export async function* runTurn({
  model,
  messages,
  abortSignal,
  system = systemPrompt("consult"),
  tools = [],
  approve,
  maxSteps = DEFAULT_MAX_STEPS,
}: TurnOptions): AsyncGenerator<TurnEvent> {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  // What is really in the context: the last model call's input and output, not the sum of steps.
  let contextTokens: number | null = null;
  try {
    const result = streamText({
      model,
      instructions: system,
      // Only what the SDK expects: ids are Bochica's bookkeeping.
      messages: messages.map(({ role, content }) => ({ role, content })),
      abortSignal,
      maxRetries: 2,
      ...(tools.length > 0
        ? { tools: toToolSet(tools, approve), stopWhen: stepCountIs(maxSteps) }
        : {}),
      // Errors arrive as stream parts and are reported below; skip the SDK's console logging.
      onError: () => {},
    });
    for await (const part of result.stream) {
      switch (part.type) {
        case "text-delta":
          if (part.text) yield { type: "text-delta", text: part.text };
          break;
        case "tool-call": {
          const tool = byName.get(part.toolName);
          yield {
            type: "tool-call",
            callId: part.toolCallId,
            server: tool?.server ?? "unknown",
            tool: tool?.tool ?? part.toolName,
            input: part.input,
          };
          break;
        }
        case "tool-result": {
          const outcome = part.output as ToolOutcome;
          yield {
            type: "tool-result",
            callId: part.toolCallId,
            status: outcome.status,
            output: truncate(outcome.text, DISPLAY_OUTPUT_LIMIT),
            ...(outcome.blocked ? { blocked: outcome.blocked } : {}),
            ...(outcome.diff ? { diff: outcome.diff } : {}),
            ...(outcome.auto ? { auto: outcome.auto } : {}),
          };
          break;
        }
        case "tool-error":
          yield {
            type: "tool-result",
            callId: part.toolCallId,
            status: "error",
            output: redactSecrets(
              part.error instanceof Error ? part.error.message : String(part.error),
            ),
          };
          break;
        case "finish-step":
          contextTokens =
            part.usage.inputTokens === undefined
              ? null
              : part.usage.inputTokens + (part.usage.outputTokens ?? 0);
          break;
        case "error":
          yield toErrorEvent(part.error);
          return;
        case "abort":
          yield { type: "turn-end", reason: "aborted" };
          return;
        case "finish":
          yield {
            type: "turn-end",
            reason: part.finishReason === "length" ? "length" : "stop",
            usage: {
              inputTokens: part.totalUsage.inputTokens ?? null,
              outputTokens: part.totalUsage.outputTokens ?? null,
              contextTokens,
            },
          };
          return;
        default:
          break;
      }
    }
    // The stream ended without a finish part (e.g. aborted before it started).
    yield { type: "turn-end", reason: abortSignal.aborted ? "aborted" : "stop" };
  } catch (error) {
    if (abortSignal.aborted) {
      yield { type: "turn-end", reason: "aborted" };
      return;
    }
    yield toErrorEvent(error);
  }
}

function toErrorEvent(error: unknown): TurnEvent {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  const message = cause instanceof Error ? cause.message : String(cause);
  return { type: "error", code: classify(cause), message: redactSecrets(message) };
}

function classify(error: unknown): ChatErrorCode {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? 0;
    if (status === 401 || status === 403) return "invalid_key";
    if (status === 429) return "rate_limit";
    if (status === 404) return "model_not_found";
    if (status >= 500) return "provider_unavailable";
    if (status === 0) return "network";
    return "unknown";
  }
  if (
    error instanceof TypeError ||
    (error instanceof Error && /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT/i.test(error.message))
  ) {
    return "network";
  }
  return "unknown";
}
