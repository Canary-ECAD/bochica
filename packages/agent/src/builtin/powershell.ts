import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { win32 } from "node:path";
import type { AgentTool, Assessment, ToolRunResult } from "../tools";
import { assessCommand, type CommandBlock } from "./command-guard";
import { deniedBy } from "./deny-rules";
import { isDevicePath } from "./paths";

// The PowerShell tool. Windows PowerShell 5.1 ships with every Windows, so it is always there.
// The command runs in the session's working folder with a filtered environment (guardrails
// layer 7): API keys and anything else Bochica holds never reach it.

export interface PowerShellOptions {
  /** The session's working folder: absolute and existing. */
  cwd: string;
  /** Bochica's environment; only the variables in SAFE_ENV are passed on. */
  env: Record<string, string | undefined>;
  /** Reads a script a command runs, so the guard can check it too. */
  readScript?: (path: string) => string | null;
  /** The user's "never allow" patterns (guardrails layer 3). */
  denyRules?: readonly string[];
  /** For tests. */
  executable?: string;
}

const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 600;
const MAX_OUTPUT_CHARS = 100_000;

/** What a command may see of Bochica's environment; nothing else is inherited. */
const SAFE_ENV = new Set(
  [
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "SystemDrive",
    "windir",
    "ComSpec",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "USERNAME",
    "USERDOMAIN",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "CommonProgramFiles",
    "CommonProgramFiles(x86)",
    "CommonProgramW6432",
    "PUBLIC",
    "ALLUSERSPROFILE",
    "COMPUTERNAME",
    "OS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "NUMBER_OF_PROCESSORS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
  ].map((name) => name.toLowerCase()),
);

export function safeEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && SAFE_ENV.has(entry[0].toLowerCase()),
    ),
  );
}

const commandBlockReasons: Record<CommandBlock, string> = {
  malformed: "the command could not be parsed (unbalanced quotes or brackets, or nested too deep).",
  "device-path": "device and NT namespace paths (\\\\?\\, \\\\.\\) are not allowed.",
  disk: "formatting or wiping disks is never allowed.",
  "system-delete":
    "recursively deleting a drive, Windows, Program Files or a user's profile is never allowed.",
  boot: "changing boot settings or deleting backups and restore points is never allowed.",
  "download-exec": "downloading something and running it is never allowed.",
  "kill-bochica": "stopping Bochica itself is never allowed.",
};

/** Layer 1 for the terminal: the folder it runs in must be absolute, real and not a device. */
export function checkWorkingFolder(cwd: string): string | null {
  if (isDevicePath(cwd) || !win32.isAbsolute(cwd))
    return "The working folder must be an absolute path.";
  if (!existsSync(cwd) || !statSync(cwd).isDirectory())
    return `The working folder ${cwd} does not exist.`;
  return null;
}

function text(input: unknown, name: string): string {
  const value =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)[name]
      : undefined;
  return typeof value === "string" ? value : "";
}

/** Keeps the start and the end of long output, which is where the useful parts usually are. */
function clip(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const half = MAX_OUTPUT_CHARS / 2;
  return `${output.slice(0, half)}\n\n[… ${output.length - MAX_OUTPUT_CHARS} characters cut …]\n\n${output.slice(-half)}`;
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on(
    "error",
    () => {},
  );
}

/** UTF-8 output, no progress bars, and an exit code that reflects failures. */
function wrap(command: string): string {
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    command,
    "$bochicaOk = $?",
    "if ($LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $bochicaOk) { exit 1 }",
  ].join("\n");
}

export function runPowerShell(
  command: string,
  options: PowerShellOptions,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ToolRunResult> {
  const encoded = Buffer.from(wrap(command), "utf16le").toString("base64");
  return new Promise((resolve) => {
    const child = spawn(
      options.executable ?? "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-OutputFormat",
        "Text",
        "-EncodedCommand",
        encoded,
      ],
      {
        cwd: options.cwd,
        env: safeEnv(options.env),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    let ended: "timeout" | "stopped" | null = null;
    const collect = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      // Keep memory bounded on runaway output; clip() trims what is returned.
      if (output.length > MAX_OUTPUT_CHARS * 4) output = clip(output);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const stop = (reason: "timeout" | "stopped") => {
      ended ??= reason;
      killTree(child.pid);
    };
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    const onAbort = () => stop("stopped");
    signal.addEventListener("abort", onAbort, { once: true });
    const finish = (result: ToolRunResult) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    child.on("error", (error) =>
      finish({ ok: false, text: `PowerShell could not start: ${error.message}` }),
    );
    child.on("close", (code) => {
      const body = clip(output.replace(/\r\n/g, "\n").trimEnd()) || "[no output]";
      if (ended === "timeout") {
        finish({
          ok: false,
          text: `${body}\n\n[stopped: the command took longer than ${Math.round(timeoutMs / 1000)} s]`,
        });
      } else if (ended === "stopped") {
        finish({ ok: false, text: `${body}\n\n[stopped by the user]` });
      } else {
        finish({ ok: code === 0, text: code === 0 ? body : `${body}\n\n[exit code ${code}]` });
      }
    });
  });
}

/** Reads a script a command runs, if it is a reasonably small text file. */
function readScriptFile(path: string): string | null {
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size > 1024 * 1024) return null;
    const buffer = readFileSync(path);
    return buffer[0] === 0xff && buffer[1] === 0xfe
      ? buffer.subarray(2).toString("utf16le")
      : buffer.toString("utf8");
  } catch {
    return null;
  }
}

export function powershellTool(options: PowerShellOptions): AgentTool {
  const assess = (input: unknown): Assessment => {
    const command = text(input, "command");
    const result = assessCommand(command, {
      cwd: options.cwd,
      env: safeEnv(options.env),
      readScript: options.readScript ?? readScriptFile,
    });
    if ("block" in result)
      return { block: result.block, reason: commandBlockReasons[result.block] };
    const rule = deniedBy(command, options.denyRules ?? []);
    if (rule) {
      return {
        block: "user-rule",
        reason: `the user's own rules in Bochica's settings never allow commands like this one (rule "${rule}").`,
      };
    }
    return { risks: result.risks };
  };
  return {
    name: "bochica__powershell",
    server: "bochica",
    tool: "powershell",
    description: `Run a Windows PowerShell 5.1 command in the working folder (${options.cwd}). The user sees your description and approves each command, so describe the outcome in plain words in the user's language. Use it for things the file tools can't do (copying, zipping, running programs). Commands can't be interactive. Some commands are refused outright (wiping disks, deleting system folders, download-and-run); do not try to get around a refusal.`,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The PowerShell command to run." },
        description: {
          type: "string",
          description:
            "What the command will do, in one short plain sentence in the user's language, e.g. 'Zip the exports folder into exports.zip'.",
        },
        timeout_seconds: {
          type: "integer",
          minimum: 1,
          maximum: MAX_TIMEOUT_S,
          description: `Default ${DEFAULT_TIMEOUT_S}.`,
        },
      },
      required: ["command", "description"],
    },
    approval: "ask",
    assess,
    execute: async (input, signal) => {
      const folder = checkWorkingFolder(options.cwd);
      if (folder) return { ok: false, text: folder };
      // Checked again right before running, in case a script changed after approval.
      const assessment = assess(input);
      if ("block" in assessment) return { ok: false, text: `Refused: ${assessment.reason}` };
      const seconds = Number(
        (input as Record<string, unknown> | null)?.["timeout_seconds"] ?? DEFAULT_TIMEOUT_S,
      );
      const timeout = Math.min(Math.max(1, seconds || DEFAULT_TIMEOUT_S), MAX_TIMEOUT_S) * 1000;
      return runPowerShell(text(input, "command"), options, timeout, signal);
    },
  };
}
