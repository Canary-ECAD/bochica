import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import type { ModelInfo } from "@bochica/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { safeEnv } from "./builtin/powershell";
import type { ClaudeRequest, ClaudeRun } from "./claude-agent";

// The user's own Claude Code on this computer, run through Anthropic's Claude Agent SDK. Bochica
// never touches its login: Claude Code reads it itself. Each run is isolated from the user's
// Claude Code setup (no settings, skills, other MCP servers, memory or saved transcript), has no
// built-in tools, and gets Bochica's tools from an in-process MCP server named "b".

const SERVER = "b";
/** Tool round-trips Claude Code may make in one model call. */
const MAX_TURNS = 30;
const STATUS_TIMEOUT_MS = 15_000;

export interface ClaudeCodeSetup {
  /** Path to `claude.exe`. */
  executable: string;
  /** What Claude Code may see of the environment; from `claudeCodeEnv`. */
  env: Record<string, string>;
  /** Folder Claude Code runs in; it has no file tools, so this is only where it starts. */
  cwd: string;
}

/** The native Windows install first, then `claude.exe` on PATH. */
export function findClaudeCode(env: Record<string, string | undefined>): string | undefined {
  const profile = env["USERPROFILE"];
  const candidates = [
    ...(profile ? [join(profile, ".local", "bin", "claude.exe")] : []),
    ...(env["PATH"] ?? env["Path"] ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((dir) => join(dir, "claude.exe")),
  ];
  return candidates.find((path) => existsSync(path));
}

/**
 * The terminal's filtered environment: no API key rides along, so Claude Code uses the plan it
 * is signed in to. `app` names Bochica in Claude Code's User-Agent.
 */
export function claudeCodeEnv(
  env: Record<string, string | undefined>,
  app: string,
): Record<string, string> {
  return {
    ...safeEnv(env),
    CLAUDE_AGENT_SDK_CLIENT_APP: app,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  };
}

const AuthStatus = z.object({ loggedIn: z.boolean() });

/** Whether Claude Code has someone signed in, from `claude auth status`. */
export function claudeCodeSignedIn(setup: ClaudeCodeSetup): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile(
      setup.executable,
      ["auth", "status", "--json"],
      { env: setup.env, timeout: STATUS_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        // Signed out exits non-zero but still prints the status.
        try {
          resolve(AuthStatus.parse(JSON.parse(stdout)).loggedIn);
        } catch {
          reject(error ?? new Error("Claude Code gave no status."));
        }
      },
    );
  });
}

/** The models Claude Code offers to the signed-in plan. */
export async function listClaudeModels(setup: ClaudeCodeSetup): Promise<ModelInfo[]> {
  const run = query({ prompt: waitForever(), options: baseOptions(setup) });
  try {
    const models = await run.supportedModels();
    return models.map((model) => ({ id: model.value, label: model.displayName }));
  } finally {
    run.close();
  }
}

/** Runs Claude Code once per model call, with the request's tools behind an MCP server. */
export function claudeCodeRun(setup: ClaudeCodeSetup): ClaudeRun {
  return (request) => runOnce(setup, request);
}

async function* runOnce(setup: ClaudeCodeSetup, request: ClaudeRequest): AsyncIterable<unknown> {
  const abortController = new AbortController();
  const stop = () => abortController.abort();
  request.signal.addEventListener("abort", stop, { once: true });
  const run = query({
    prompt: request.prompt,
    options: {
      ...baseOptions(setup),
      abortController,
      model: request.model,
      systemPrompt: request.system,
      maxTurns: MAX_TURNS,
      includePartialMessages: true,
      ...(request.tools.length > 0
        ? { mcpServers: { [SERVER]: { type: "sdk", name: SERVER, instance: toolServer(request) } } }
        : {}),
      // Only Bochica's own server's tools; they ask the user themselves (runTool).
      canUseTool: async (_name, input, { mcpServer }) =>
        mcpServer?.source === "sdk" && mcpServer.name === SERVER
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "Only Bochica's tools are available." },
    },
  });
  try {
    yield* run;
  } finally {
    request.signal.removeEventListener("abort", stop);
    run.close();
  }
}

/** What every run shares: the user's Claude Code, cut off from its own setup. */
function baseOptions(setup: ClaudeCodeSetup): Options {
  return {
    pathToClaudeCodeExecutable: setup.executable,
    env: setup.env,
    cwd: setup.cwd,
    tools: [],
    settingSources: [],
    skills: [],
    strictMcpConfig: true,
    persistSession: false,
    permissionMode: "default",
  };
}

function toolServer(request: ClaudeRequest): McpServer {
  const server = new McpServer({ name: SERVER, version: "1.0.0" }, { capabilities: { tools: {} } });
  const byName = new Map(request.tools.map((tool) => [tool.name, tool]));
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: request.tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema: { type: "object", ...inputSchema },
    })),
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const tool = byName.get(params.name);
    if (!tool) return { content: [{ type: "text", text: "Unknown tool." }], isError: true };
    // Claude Code sends the id of its tool_use block, which the approval card is matched by.
    // oxlint-disable-next-line no-underscore-dangle
    const id = params._meta?.["claudecode/toolUseId"];
    const { text, isError } = await tool.call(
      params.arguments ?? {},
      typeof id === "string" ? id : undefined,
    );
    return { content: [{ type: "text", text }], isError };
  });
  return server;
}

/** A prompt stream that sends nothing, for runs that only ask Claude Code something. */
function waitForever(): AsyncIterable<never> {
  return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
}
