import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { randomUUID } from "node:crypto";
import { APICallError } from "ai";
import { z } from "zod";
import { runTool } from "./tools";
import { turnToolsFor } from "./turn-tools";

// Claude Agent: the user's own Claude Code, signed in to their Claude plan, as a model. Claude
// Code drives the tool round-trips itself, so one model call is a whole run: it streams text,
// and Bochica's tools reach it through an in-process MCP server and run through `runTool`, with
// the approver of the turn that made the call (turn-tools.ts). The AI SDK sees them as
// provider-executed calls with their results. claude-code.ts runs the real Claude Code.

/** A Bochica tool as Claude Code sees it. */
interface ClaudeTool {
  /** Short and unique within the run; Claude Code shows it as `mcp__b__<name>`. */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Runs the call. `toolUseId` is Claude Code's id for it, when it sends one. */
  call(input: unknown, toolUseId: string | undefined): Promise<{ text: string; isError: boolean }>;
}

export interface ClaudeRequest {
  model: string;
  system: string;
  prompt: string;
  tools: ClaudeTool[];
  signal: AbortSignal;
}

/** Runs Claude Code once and yields its output messages (the Agent SDK's `SDKMessage`). */
export type ClaudeRun = (request: ClaudeRequest) => AsyncIterable<unknown>;

// The parts of Claude Code's output Bochica reads; everything else is skipped.

const StreamEvent = z.object({
  type: z.literal("stream_event"),
  parent_tool_use_id: z.string().nullable(),
  event: z.object({
    type: z.string(),
    index: z.number().optional(),
    content_block: z.object({ type: z.string() }).optional(),
    delta: z.object({ type: z.string(), text: z.string().optional() }).optional(),
  }),
});

const AssistantError = z.object({
  type: z.literal("assistant"),
  parent_tool_use_id: z.null(),
  error: z.string(),
});

const Result = z.object({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  errors: z.array(z.string()).optional(),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_read_input_tokens: z.number().nullish(),
      cache_creation_input_tokens: z.number().nullish(),
    })
    .optional(),
});

/** Claude Code's error kinds as the HTTP status the loop and the key pool understand. */
const errorStatus: Record<string, number> = {
  authentication_failed: 401,
  oauth_org_not_allowed: 403,
  account_on_hold: 403,
  verification_required: 401,
  billing_error: 402,
  rate_limit: 429,
  overloaded: 529,
  server_error: 500,
  model_not_found: 404,
  invalid_request: 400,
};

export function claudeAgentModel(modelId: string, run: ClaudeRun): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "claude-agent",
    modelId,
    supportedUrls: {},
    doStream: async (options) => ({ stream: streamRun(modelId, run, options) }),
    doGenerate: async (options) => {
      const content: LanguageModelV4Content[] = [];
      let text = "";
      let finish: Extract<LanguageModelV4StreamPart, { type: "finish" }> | undefined;
      const reader = streamRun(modelId, run, options).getReader();
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === "text-delta") text += value.delta;
        if (value.type === "tool-call" || value.type === "tool-result") content.push(value);
        if (value.type === "error") throw value.error;
        if (value.type === "finish") finish = value;
      }
      return {
        content: text ? [{ type: "text", text }, ...content] : content,
        finishReason: finish?.finishReason ?? { unified: "other", raw: undefined },
        usage: finish?.usage ?? emptyUsage(),
        warnings: [],
      };
    },
  };
}

function streamRun(
  modelId: string,
  run: ClaudeRun,
  options: LanguageModelV4CallOptions,
): ReadableStream<LanguageModelV4StreamPart> {
  const signal = options.abortSignal ?? new AbortController().signal;
  return new ReadableStream<LanguageModelV4StreamPart>({
    async start(controller) {
      const push = (part: LanguageModelV4StreamPart) => {
        if (!signal.aborted) controller.enqueue(part);
      };
      push({ type: "stream-start", warnings: [] });
      const { system, prompt } = transcript(options.prompt);
      // Claude Code's own text blocks, numbered per message so ids stay unique.
      let message = 0;
      const open = new Set<string>();
      let assistantError: string | undefined;
      try {
        for await (const raw of run({
          model: modelId,
          system,
          prompt,
          tools: exposedTools(options, signal, push),
          signal,
        })) {
          const event = StreamEvent.safeParse(raw);
          if (event.success && event.data.parent_tool_use_id === null) {
            const { type, index = 0, content_block: block, delta } = event.data.event;
            const id = `${message}-${index}`;
            if (type === "message_start") message += 1;
            else if (type === "content_block_start" && block?.type === "text") {
              open.add(id);
              push({ type: "text-start", id });
            } else if (type === "content_block_delta" && delta?.type === "text_delta") {
              if (delta.text) push({ type: "text-delta", id, delta: delta.text });
            } else if (type === "content_block_stop" && open.delete(id)) {
              push({ type: "text-end", id });
            }
            continue;
          }
          const failed = AssistantError.safeParse(raw);
          if (failed.success) {
            assistantError = failed.data.error;
            continue;
          }
          const result = Result.safeParse(raw);
          if (!result.success) continue;
          for (const id of open) push({ type: "text-end", id });
          open.clear();
          const { subtype, is_error: isError, usage } = result.data;
          if (isError && subtype !== "error_max_turns") {
            const detail = result.data.errors?.join(" ") || result.data.result || subtype;
            push({ type: "error", error: claudeError(assistantError, detail) });
          } else {
            push({
              type: "finish",
              finishReason:
                subtype === "error_max_turns"
                  ? { unified: "length", raw: subtype }
                  : { unified: "stop", raw: subtype },
              usage: toUsage(usage),
            });
          }
        }
      } catch (error) {
        if (!signal.aborted) push({ type: "error", error });
      } finally {
        controller.close();
      }
    },
  });
}

/**
 * The turn's tools that this call offers, wrapped for Claude Code. Each call shows up in the
 * stream as a provider-executed tool call, runs with the turn's approver, and its outcome follows
 * as the tool result, exactly as the loop would report it.
 */
function exposedTools(
  options: LanguageModelV4CallOptions,
  signal: AbortSignal,
  push: (part: LanguageModelV4StreamPart) => void,
): ClaudeTool[] {
  const turn = turnToolsFor(options.providerOptions);
  if (!turn) return [];
  const offered = new Set(
    (options.tools ?? []).filter((t) => t.type === "function").map((t) => t.name),
  );
  return [...turn.tools.values()]
    .filter((tool) => offered.has(tool.name))
    .map((tool, index) => ({
      name: shortName(tool.name, index),
      description: tool.description,
      inputSchema: tool.inputSchema,
      call: async (input, toolUseId) => {
        const callId = toolUseId ?? `claude-${randomUUID()}`;
        push({
          type: "tool-call",
          toolCallId: callId,
          toolName: tool.name,
          input: JSON.stringify(input ?? {}),
          providerExecuted: true,
        });
        const outcome = await runTool(tool, input ?? {}, {
          callId,
          approve: turn.approve,
          signal,
        });
        push({
          type: "tool-result",
          toolCallId: callId,
          toolName: tool.name,
          result: { ...outcome },
        });
        return { text: outcome.text, isError: outcome.status !== "ok" };
      },
    }));
}

/** Claude Code adds `mcp__b__` and API tool names stop at 64 characters. */
function shortName(name: string, index: number): string {
  const plain = name.replace(/^mcp__/, "");
  return plain.length <= 56 ? plain : `${plain.slice(0, 50)}_${index}`;
}

/**
 * Claude Code takes one prompt, not a message list: the system prompt goes on its own, earlier
 * exchanges become a transcript, and the newest user message comes last.
 */
export function transcript(prompt: LanguageModelV4Prompt): { system: string; prompt: string } {
  const system: string[] = [];
  const turns: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const message of prompt) {
    if (message.role === "system") system.push(message.content);
    else if (message.role === "user" || message.role === "assistant") {
      const text = message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
        .trim();
      if (text) turns.push({ role: message.role, text });
    }
  }
  const last = turns.at(-1);
  const earlier = last?.role === "user" ? turns.slice(0, -1) : turns;
  const newest = last?.role === "user" ? last.text : "";
  if (earlier.length === 0) return { system: system.join("\n\n"), prompt: newest };
  const history = earlier
    .map((turn) => `<${turn.role}>\n${turn.text}\n</${turn.role}>`)
    .join("\n\n");
  return {
    system: system.join("\n\n"),
    prompt: `<conversation_so_far>\n${history}\n</conversation_so_far>\n\n${newest}`,
  };
}

function claudeError(kind: string | undefined, detail: string): APICallError {
  return new APICallError({
    message: detail,
    url: "claude-code",
    requestBodyValues: {},
    statusCode: (kind && errorStatus[kind]) || 500,
    isRetryable: kind === "rate_limit" || kind === "overloaded",
  });
}

function toUsage(usage: z.infer<typeof Result>["usage"]): LanguageModelV4Usage {
  if (!usage) return emptyUsage();
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: {
      total: usage.input_tokens + cacheRead + cacheWrite,
      noCache: usage.input_tokens,
      cacheRead,
      cacheWrite,
    },
    outputTokens: { total: usage.output_tokens, text: usage.output_tokens, reasoning: undefined },
  };
}

function emptyUsage(): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}
