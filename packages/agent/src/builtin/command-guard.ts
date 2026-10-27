import { win32 } from "node:path";

// Guardrails layers 1, 2 and 5 for PowerShell commands (see docs/design/guardrails.md). The
// command is split into statements the way PowerShell and cmd would, nested commands are
// assessed too, and anything that cannot be parsed is refused: this fails closed. It is a
// safety net for an agent's mistakes, not a sandbox; every command still asks the user.

/** Why a command is refused outright. Not overridable, not even by the user. */
export type CommandBlock =
  | "malformed"
  | "device-path"
  | "disk"
  | "system-delete"
  | "boot"
  | "download-exec"
  | "kill-bochica";

/** Why a command must ask every time; each one is explained to the user on the card. */
export type CommandRisk =
  | "delete"
  | "recursive-delete"
  | "stop-process"
  | "registry"
  | "execution-policy"
  | "service"
  | "scheduled-task"
  | "shutdown"
  | "accounts"
  | "security-settings"
  | "elevation"
  | "obfuscation"
  | "invisible-chars"
  | "secret-upload"
  | "unknown-script";

export type CommandAssessment = { block: CommandBlock } | { risks: CommandRisk[] };

export interface CommandContext {
  /** Where the command runs; relative paths resolve against it. */
  cwd: string;
  /** The environment the command sees, to expand `$env:X`, `%X%` and `~`. */
  env: Record<string, string | undefined>;
  /** Reads a script the command runs (`.ps1`, `.bat`…), or null when it can't. */
  readScript?: (path: string) => string | null;
}

const MAX_DEPTH = 4;

const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const HAS_INVISIBLE = new RegExp(INVISIBLE.source);
const DEVICE_PATH = /(^|[\s'"(=,:])[\\/]{2}[?.][\\/]|\\\?\?\\/;

/** PowerShell 5.1 default aliases that matter here, plus a few cmd built-ins. */
const ALIASES: Record<string, string> = {
  rm: "remove-item",
  del: "remove-item",
  erase: "remove-item",
  ri: "remove-item",
  rd: "remove-item",
  rmdir: "remove-item",
  kill: "stop-process",
  spps: "stop-process",
  iex: "invoke-expression",
  iwr: "invoke-webrequest",
  curl: "invoke-webrequest",
  wget: "invoke-webrequest",
  irm: "invoke-restmethod",
  sp: "set-itemproperty",
  rp: "remove-itemproperty",
  spsv: "stop-service",
  saps: "start-process",
  start: "start-process",
  icm: "invoke-command",
  gci: "get-childitem",
  ls: "get-childitem",
  dir: "get-childitem",
  ni: "new-item",
  si: "set-item",
};

const SHELLS = new Set(["powershell", "pwsh", "powershell_ise"]);
const DOWNLOADERS = new Set([
  "invoke-webrequest",
  "invoke-restmethod",
  "curl",
  "wget",
  "start-bitstransfer",
  "bitsadmin",
  "certutil",
]);
const UPLOADERS = new Set(["send-mailmessage", "ftp", "tftp", "scp", "sftp"]);
const DOWNLOAD_TEXT = /net\.webclient|download(string|file|data)|net\.http\.httpclient|xmlhttp/;
const SCRIPT_EXT = /\.(ps1|psm1|bat|cmd)$/;
const OPAQUE_EXT = /\.(vbs|vbe|js|jse|wsf|hta|py|pyw|jar)$/;
const OPAQUE_RUNNERS = new Set([
  "python",
  "pythonw",
  "py",
  "node",
  "wscript",
  "cscript",
  "mshta",
  "rundll32",
  "regsvr32",
  "java",
]);
const REGISTRY_TARGET = /^(hklm|hkcu|hkcr|hku|hkcc):|^registry::|^hkey_/;
const ITEM_CMDLETS = new Set([
  "set-itemproperty",
  "new-itemproperty",
  "remove-itemproperty",
  "rename-itemproperty",
  "clear-itemproperty",
  "copy-itemproperty",
  "move-itemproperty",
  "new-item",
  "remove-item",
  "set-item",
  "clear-item",
  "rename-item",
  "move-item",
  "copy-item",
  "set-acl",
]);
const SECRET_TEXT =
  /\$\{?env:\w*(key|token|secret|pass|pwd|credential|auth)|%\w*(key|token|secret|pass)\w*%|\.ssh|\.aws|\.azure|\.kube|\.netrc|\.git-credentials|id_(rsa|ed25519|ecdsa)|\.env\b|credentials|\.pem\b|\.pfx\b|get-credential|convertfrom-securestring/;

interface Findings {
  block?: CommandBlock;
  risks: Set<CommandRisk>;
  download: boolean;
  /** Something that runs code: iex, a nested shell, Start-Process, a script or program. */
  sink: boolean;
  network: boolean;
  delete: boolean;
  stopProcess: boolean;
  /** Paths walked by a recursive statement, e.g. `Get-ChildItem C:\ -Recurse | Remove-Item`. */
  recursiveTargets: string[];
}

export function assessCommand(command: string, context: CommandContext): CommandAssessment {
  const findings: Findings = {
    risks: new Set(),
    download: false,
    sink: false,
    network: false,
    delete: false,
    stopProcess: false,
    recursiveTargets: [],
  };
  analyze(command, context, 0, findings);
  if (findings.block) return { block: findings.block };

  const env = lowerKeys(context.env);
  if (findings.download && findings.sink) return { block: "download-exec" };
  if (
    findings.delete &&
    findings.recursiveTargets.some((target) => isSystemTarget(target, context.cwd, env))
  ) {
    return { block: "system-delete" };
  }
  if (findings.stopProcess && /bochica/i.test(command)) return { block: "kill-bochica" };
  if ((findings.network || findings.download) && SECRET_TEXT.test(compact(command))) {
    findings.risks.add("secret-upload");
  }
  return { risks: [...findings.risks] };
}

function analyze(text: string, context: CommandContext, depth: number, out: Findings): void {
  if (out.block) return;
  if (depth > MAX_DEPTH) {
    out.block = "malformed";
    return;
  }
  if (HAS_INVISIBLE.test(text)) out.risks.add("invisible-chars");
  const clean = text.replace(INVISIBLE, "");
  if (DEVICE_PATH.test(clean)) {
    out.block = "device-path";
    return;
  }
  const flat = compact(clean);
  if (DOWNLOAD_TEXT.test(flat)) out.download = true;
  if (/scriptblock::create|\.invoke\b/.test(flat)) {
    out.risks.add("obfuscation");
    out.sink = true;
  }
  if (/upload(string|file|data)|-method(post|put)|-infile/.test(flat)) out.network = true;
  // .NET calls that bypass the cmdlets.
  if (/\]::delete|deletedirectory|deletefile|\.delete\b/.test(flat)) {
    out.delete = true;
    out.risks.add("delete");
  }
  if (
    /win32\.registry|registrykey/.test(flat) &&
    /setvalue|deletesubkey|deletevalue|createsubkey/.test(flat)
  )
    out.risks.add("registry");
  if (/\.kill\b/.test(flat)) {
    out.stopProcess = true;
    out.risks.add("stop-process");
  }

  const lexed = lex(clean);
  if (!lexed) {
    out.block = "malformed";
    return;
  }
  if (lexed.computed) {
    out.risks.add("obfuscation");
    out.sink = true;
  }
  for (const nested of lexed.nested) analyze(nested, context, depth + 1, out);
  for (const words of lexed.statements) statement(words, context, depth, out);
}

function statement(all: string[], context: CommandContext, depth: number, out: Findings): void {
  if (out.block) return;
  const words = withoutAssignment(all);
  // `. .\x.ps1` runs what follows.
  const start = words[0] === "." ? 1 : 0;
  const raw = words[start];
  if (raw === undefined || raw.startsWith("$")) return;
  const args = words.slice(start + 1);
  const lowerArgs = args.map((a) => a.toLowerCase());
  const base = (raw.split(/[\\/]/).at(-1) ?? raw).toLowerCase();
  const exe = base.replace(/\.(exe|com)$/, "");
  const name = base === "sc.exe" || base === "curl.exe" ? exe : (ALIASES[exe] ?? exe);
  const has = (...values: string[]) => lowerArgs.some((a) => values.includes(a));
  const nested = (source: string) => analyze(source, context, depth + 1, out);

  // Running a script or program.
  if (SCRIPT_EXT.test(base)) {
    out.sink = true;
    runScript(raw, context, depth, out);
    return;
  }
  if (OPAQUE_EXT.test(base) || OPAQUE_RUNNERS.has(exe)) {
    out.sink = true;
    out.risks.add("unknown-script");
    return;
  }
  // A program run from a folder (`.\setup.exe`), e.g. one just downloaded.
  if ((/[\\/]/.test(raw) && base.endsWith(".exe")) || base.endsWith(".msi") || exe === "msiexec")
    out.sink = true;

  // Layer 2: never.
  if (
    ["format-volume", "clear-disk", "initialize-disk", "remove-partition", "diskpart"].includes(
      name,
    )
  )
    return block(out, "disk");
  if (name === "format" && lowerArgs.some((a) => /^[a-z]:\\?$/.test(a))) return block(out, "disk");
  if (name === "cipher" && lowerArgs.some((a) => a.startsWith("/w"))) return block(out, "disk");
  if (name === "bcdedit" || name === "bcdboot") return block(out, "boot");
  if (name === "vssadmin" && has("delete", "resize")) return block(out, "boot");
  if (name === "wbadmin" && has("delete")) return block(out, "boot");
  if (name === "wmic" && has("shadowcopy") && has("delete")) return block(out, "boot");
  if (name === "reagentc" && has("/disable")) return block(out, "boot");

  const recursive = lowerArgs.some(isRecurseFlag);
  if (recursive) out.recursiveTargets.push(...pathArgs(args));

  if (name === "remove-item") {
    out.delete = true;
    out.risks.add(recursive ? "recursive-delete" : "delete");
  }
  if (ITEM_CMDLETS.has(name) && lowerArgs.some((a) => REGISTRY_TARGET.test(stripPathParam(a))))
    out.risks.add("registry");
  if (name === "reg" && has("add", "delete", "import", "copy", "restore", "load", "unload"))
    out.risks.add("registry");
  if (name === "regedit") out.risks.add("registry");

  if (name === "stop-process" || name === "taskkill" || (name === "wmic" && has("process"))) {
    out.stopProcess = true;
    out.risks.add("stop-process");
  }
  if (name === "set-executionpolicy") out.risks.add("execution-policy");
  if (
    ["stop-service", "set-service", "new-service", "remove-service", "restart-service"].includes(
      name,
    ) ||
    name === "suspend-service" ||
    (name === "sc" && has("config", "delete", "stop", "create", "failure", "pause", "sdset")) ||
    ((name === "net" || name === "net1") && has("stop", "start", "pause"))
  )
    out.risks.add("service");
  if (
    (name === "schtasks" && has("/create", "/change", "/delete", "/run", "/end")) ||
    /^(register|unregister|set|start|enable|disable)-scheduledtask$/.test(name)
  )
    out.risks.add("scheduled-task");
  if (["shutdown", "stop-computer", "restart-computer", "logoff"].includes(name))
    out.risks.add("shutdown");
  if (
    ((name === "net" || name === "net1") && has("user", "localgroup") && has("/add", "/delete")) ||
    /^(new|remove|set|enable|disable)-localuser$|^(add|remove)-localgroupmember$/.test(name)
  )
    out.risks.add("accounts");
  if (
    /^(set|add|remove)-mppreference$/.test(name) ||
    (name === "netsh" && has("advfirewall", "firewall")) ||
    name === "set-netfirewallprofile"
  )
    out.risks.add("security-settings");

  if (DOWNLOADERS.has(name)) out.download = true;
  if (UPLOADERS.has(name)) out.network = true;

  // Nested commands.
  if (name === "invoke-expression") {
    out.risks.add("obfuscation");
    out.sink = true;
    nested(args.join(" "));
  } else if (name === "cmd") {
    out.sink = true;
    const at = lowerArgs.findIndex((a) => a === "/c" || a === "/k" || a === "/r");
    if (at >= 0) nested(args.slice(at + 1).join(" "));
  } else if (SHELLS.has(exe)) {
    out.sink = true;
    shell(args, lowerArgs, context, depth, out);
  } else if (name === "start-process") {
    out.sink = true;
    if (lowerArgs.some((a) => isParam(a, "verb", 2)) && has("runas")) out.risks.add("elevation");
    nested(processCommand(args));
  }
}

/** `$x = Remove-Item …` runs Remove-Item: drop the assignment. */
function withoutAssignment(words: string[]): string[] {
  const [first, second] = words;
  if (first === undefined || !first.startsWith("$")) return words;
  if (second !== undefined && /^[-+*/%?]?=$/.test(second)) return words.slice(2);
  const inline = /^\$[^=\s]*=(.+)$/.exec(first);
  return inline?.[1] ? [inline[1], ...words.slice(1)] : words;
}

function block(out: Findings, reason: CommandBlock): void {
  out.block ??= reason;
}

/** `powershell -Command …`, `-EncodedCommand …`, `-File …`. */
function shell(
  args: string[],
  lowerArgs: string[],
  context: CommandContext,
  depth: number,
  out: Findings,
): void {
  for (let i = 0; i < args.length; i++) {
    const arg = lowerArgs[i] ?? "";
    if (isParam(arg, "executionpolicy", 2) || arg === "-ep") {
      out.risks.add("execution-policy");
      i++;
      continue;
    }
    if (isParam(arg, "encodedcommand", 1) || arg === "-ec") {
      out.risks.add("obfuscation");
      const decoded = decodeUtf16(args[i + 1] ?? "");
      if (decoded === null) return block(out, "malformed");
      return analyze(decoded, context, depth + 1, out);
    }
    if (isParam(arg, "command", 1))
      return analyze(args.slice(i + 1).join(" "), context, depth + 1, out);
    if (isParam(arg, "file", 1)) return runScript(args[i + 1] ?? "", context, depth, out);
    if (!arg.startsWith("-")) return analyze(args.slice(i).join(" "), context, depth + 1, out);
    if (SHELL_VALUE_PARAMS.some(([param, min]) => isParam(arg, param, min))) i++;
  }
}

/** powershell.exe parameters that take a value, with the shortest prefix it accepts. */
const SHELL_VALUE_PARAMS: Array<[string, number]> = [
  ["windowstyle", 1],
  ["version", 1],
  ["inputformat", 2],
  ["outputformat", 1],
  ["configurationname", 4],
  ["workingdirectory", 2],
  ["psconsolefile", 2],
  ["settingsfile", 2],
];
const PROCESS_SWITCHES = [
  "wait",
  "nonewwindow",
  "passthru",
  "usenewenvironment",
  "loaduserprofile",
];

/** Start-Process: the program plus its -ArgumentList, as one command line. */
function processCommand(args: string[]): string {
  let program = "";
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const lower = arg.toLowerCase();
    if (isParam(lower, "argumentlist", 2) || lower === "-args") {
      rest.push(...(args[++i] ?? "").split(","));
    } else if (isParam(lower, "filepath", 2)) {
      program = args[++i] ?? "";
    } else if (lower.startsWith("-")) {
      if (!PROCESS_SWITCHES.some((s) => isParam(lower, s, 2))) i++;
    } else if (!program) {
      program = arg;
    } else {
      rest.push(...arg.split(","));
    }
  }
  return [/\s/.test(program) ? `"${program}"` : program, ...rest].join(" ");
}

function runScript(path: string, context: CommandContext, depth: number, out: Findings): void {
  out.sink = true;
  const target = expand(path, lowerKeys(context.env));
  const content =
    target === null ? null : (context.readScript?.(win32.resolve(context.cwd, target)) ?? null);
  if (content === null) {
    out.risks.add("unknown-script");
    return;
  }
  analyze(content, context, depth + 1, out);
}

function decodeUtf16(base64: string): string | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) return null;
  return Buffer.from(base64, "base64").toString("utf16le");
}

/** PowerShell accepts any unambiguous prefix of a parameter name, and `-Name:value`. */
function isParam(arg: string, name: string, minLength: number): boolean {
  const key = arg.split(":")[0] ?? "";
  if (!key.startsWith("-")) return false;
  const body = key.slice(1);
  return body.length >= minLength && name.startsWith(body);
}

function isRecurseFlag(arg: string): boolean {
  return isParam(arg, "recurse", 1) || arg === "-rf" || arg === "-fr" || arg === "/s";
}

function stripPathParam(arg: string): string {
  return arg.replace(/^-(literal)?path:/, "");
}

/** Path-like arguments: positional ones and the values of -Path / -LiteralPath. */
function pathArgs(args: string[]): string[] {
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const lower = arg.toLowerCase();
    if (isParam(lower, "path", 1) || isParam(lower, "literalpath", 1)) {
      const value = lower.includes(":") ? arg.slice(arg.indexOf(":") + 1) : args[++i];
      if (value) paths.push(...value.split(","));
    } else if (lower.startsWith("-")) {
      // Switches take no value; anything else (e.g. -Filter *.tmp) does.
      if (
        !isRecurseFlag(lower) &&
        !isParam(lower, "force", 2) &&
        lower !== "-rf" &&
        lower !== "-fr"
      )
        i++;
    } else if (!lower.startsWith("/")) {
      paths.push(...arg.split(","));
    }
  }
  return paths.filter((p) => p.trim() !== "");
}

function lowerKeys(env: Record<string, string | undefined>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(env)) if (value) map.set(key.toLowerCase(), value);
  return map;
}

/** Expands `$env:X`, `${env:X}`, `%X%`, `$HOME` and `~`; null if a variable is unknown. */
function expand(path: string, env: Map<string, string>): string | null {
  let unknown = false;
  const value = (name: string) => {
    const found = env.get(name.toLowerCase());
    if (found === undefined) unknown = true;
    return found ?? "";
  };
  const expanded = path
    .replace(/^~(?=$|[\\/])/, () => value("USERPROFILE"))
    .replace(/\$home\b/gi, () => value("USERPROFILE"))
    .replace(/\$\{env:([^}]+)\}|\$env:(\w+(?:\(x86\))?)|%([^%]+)%/gi, (_m, a, b, c) =>
      value(String(a ?? b ?? c)),
    );
  if (unknown || /\$/.test(expanded)) return null;
  return expanded;
}

/**
 * Whether a recursive walk or delete of this path would wreck the system or the user's data: a
 * drive root, anything under Windows or Program Files, the Users folder, a user's profile root
 * or its main folders.
 */
function isSystemTarget(target: string, cwd: string, env: Map<string, string>): boolean {
  const expanded = expand(target.trim(), env);
  if (expanded === null) return false;
  let path = expanded.replaceAll("/", "\\");
  const wildcard = path.search(/[*?]/);
  if (wildcard >= 0) path = path.slice(0, path.lastIndexOf("\\", wildcard) + 1) || ".";
  const full = win32.resolve(cwd, path).replace(/\\+$/, "").toLowerCase();
  if (/^[a-z]:$/.test(full)) return true;
  const under = (root: string | undefined) => {
    if (!root) return false;
    const r = win32.resolve(root).replace(/\\+$/, "").toLowerCase();
    return full === r || full.startsWith(`${r}\\`);
  };
  const drive = full.slice(0, 2);
  const systemRoots = [
    env.get("systemroot") ?? `${drive}\\windows`,
    env.get("programfiles") ?? `${drive}\\program files`,
    env.get("programfiles(x86)") ?? `${drive}\\program files (x86)`,
    env.get("programdata") ?? `${drive}\\programdata`,
  ];
  if (systemRoots.some(under)) return true;
  // C:\Users, C:\Users\<name>, and a profile's main folders.
  if (/^[a-z]:\\users(\\[^\\]+)?$/.test(full)) return true;
  const profile = env.get("userprofile");
  if (profile) {
    const p = win32.resolve(profile).toLowerCase();
    const main = ["desktop", "documents", "downloads", "onedrive", "pictures", "appdata"];
    if (full === p || main.some((folder) => full === `${p}\\${folder}`)) return true;
  }
  return false;
}

/** Lowercase, without whitespace, quotes, escapes or brackets: for substring checks only. */
function compact(text: string): string {
  return text
    .toLowerCase()
    .replace(INVISIBLE, "")
    .replace(/[\s`^'"\u2018-\u201F()+]/g, "");
}

interface Lexed {
  statements: string[][];
  /** Code inside double-quoted strings (`"$(…)"`), assessed on its own. */
  nested: string[];
  /** `& (…)`, `. (…)`: a command whose name is computed at run time. */
  computed: boolean;
}

const SINGLE = new Set(["'", "\u2018", "\u2019", "\u201A", "\u201B"]);
const DOUBLE = new Set(['"', "\u201C", "\u201D", "\u201E"]);
const OPEN: Record<string, string> = { "(": ")", "{": "}" };

/**
 * Splits a PowerShell or cmd command line into statements of words. Separators: `;`, `|`, `&`,
 * newlines and brackets, so the inside of `(…)`, `$(…)` and `{…}` is a statement of its own.
 * Quotes are removed and their content joined to the word, as the shells do; backticks and
 * carets escape. Returns null for unbalanced quotes or brackets.
 */
function lex(text: string): Lexed | null {
  const statements: string[][] = [];
  const nested: string[] = [];
  const stack: string[] = [];
  let words: string[] = [];
  let word = null as string | null;
  let computed = false;
  let afterCall = false;

  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endStatement = () => {
    endWord();
    if (words.length > 0) statements.push(words);
    words = [];
  };
  const append = (s: string) => {
    word = (word ?? "") + s;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    const next = text[i + 1] ?? "";
    if (c === "`") {
      if (next === "\r" && text[i + 2] === "\n") i += 2;
      else if (next === "\n") i++;
      else if (next) append(text[++i] ?? "");
      continue;
    }
    if (c === "^") {
      if (next) append(text[++i] ?? "");
      continue;
    }
    if (word === null && c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      endStatement();
      continue;
    }
    if (word === null && c === "<" && next === "#") {
      const close = text.indexOf("#>", i + 2);
      if (close < 0) return null;
      i = close + 1;
      continue;
    }
    if (c === "@" && (SINGLE.has(next) || DOUBLE.has(next)) && /^\r?\n/.test(text.slice(i + 2))) {
      const quote = SINGLE.has(next) ? "'" : '"';
      const close = text.slice(i + 2).search(new RegExp(`\\n${quote}@`));
      if (close < 0) return null;
      const body = text.slice(i + 2, i + 2 + close);
      if (quote === '"') nested.push(...subexpressions(body));
      append(body);
      i = i + 2 + close + 2;
      continue;
    }
    if (SINGLE.has(c)) {
      let j = i + 1;
      let content = "";
      for (; j < text.length; j++) {
        const d = text[j] ?? "";
        if (SINGLE.has(d)) {
          if (SINGLE.has(text[j + 1] ?? "")) {
            content += "'";
            j++;
            continue;
          }
          break;
        }
        content += d;
      }
      if (j >= text.length) return null;
      append(content);
      i = j;
      continue;
    }
    if (DOUBLE.has(c)) {
      let j = i + 1;
      let content = "";
      for (; j < text.length; j++) {
        const d = text[j] ?? "";
        if (d === "`" && j + 1 < text.length) {
          content += text[++j];
          continue;
        }
        if (DOUBLE.has(d)) {
          if (DOUBLE.has(text[j + 1] ?? "")) {
            content += '"';
            j++;
            continue;
          }
          break;
        }
        content += d;
      }
      if (j >= text.length) return null;
      nested.push(...subexpressions(content));
      append(content);
      i = j;
      continue;
    }
    if (c === " " || c === "\t") {
      endWord();
      continue;
    }
    if (c === "\n" || c === "\r" || c === ";" || c === "|" || c === "&") {
      endStatement();
      afterCall = c === "&" && next !== "&";
      if (c === "&" && next === "&") i++;
      if (c === "|" && next === "|") i++;
      continue;
    }
    // `${env:ProgramFiles}` is a variable, not a script block.
    if (c === "{" && word?.endsWith("$")) {
      const close = text.indexOf("}", i);
      if (close < 0) return null;
      append(text.slice(i, close + 1));
      i = close;
      continue;
    }
    if (c === "(" || c === "{") {
      if (c === "(" && (afterCall || (word === null && words.length === 1 && words[0] === ".")))
        computed = true;
      if (word !== null && (word.endsWith("$") || word.endsWith("@")))
        word = word.slice(0, -1) || null;
      endStatement();
      stack.push(OPEN[c] ?? "");
      afterCall = false;
      continue;
    }
    if (c === ")" || c === "}") {
      if (stack.pop() !== c) return null;
      endStatement();
      continue;
    }
    // `& $command`, `. $command`: the command is computed, so it can't be judged.
    if (word === null && c === "$" && (afterCall || (words.length === 1 && words[0] === ".")))
      computed = true;
    afterCall = false;
    append(c);
  }
  if (stack.length > 0) return null;
  endStatement();
  return { statements, nested, computed };
}

/** The `$(…)` parts of a double-quoted string, which PowerShell runs. */
function subexpressions(content: string): string[] {
  const found: string[] = [];
  for (let i = content.indexOf("$("); i >= 0; i = content.indexOf("$(", i + 1)) {
    let depth = 0;
    for (let j = i + 1; j < content.length; j++) {
      if (content[j] === "(") depth++;
      else if (content[j] === ")" && --depth === 0) {
        found.push(content.slice(i + 2, j));
        break;
      }
    }
  }
  return found;
}
