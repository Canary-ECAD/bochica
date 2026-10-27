import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, win32 } from "node:path";

// Guardrails layers 1 and 4 for the file tools: refuse device paths and alternate data
// streams, keep credentials and Bochica's own data out of reach, and never write into Windows
// or Program Files. Symlinks, junctions and 8.3 names are resolved before comparing, so a link
// can't smuggle a protected folder in under another name.

export type PathBlock = "device-path" | "invalid-path" | "protected-path" | "secret-file";

export interface PathPolicy {
  /** Folders and files that are neither read nor written: credentials, browser profiles… */
  secret: string[];
  /** Folders that may be read but never written. */
  readOnly: string[];
}

function under(root: string | undefined, ...paths: string[]): string[] {
  return root ? paths.map((p) => join(root, p)) : [];
}

/**
 * The default policy for this machine. `appData` is Bochica's own folder (credentials,
 * database, settings), which the agent must never touch.
 */
export function defaultPathPolicy(
  env: Record<string, string | undefined>,
  appData: string,
): PathPolicy {
  const get = (name: string) =>
    Object.entries(env).find(([variable]) => variable.toLowerCase() === name.toLowerCase())?.[1];
  const home = get("USERPROFILE");
  const roaming = get("APPDATA");
  const local = get("LOCALAPPDATA");
  return {
    secret: [
      appData,
      ...under(
        home,
        ".ssh",
        ".aws",
        ".azure",
        ".kube",
        ".gnupg",
        ".docker",
        ".config\\gcloud",
        ".netrc",
        ".git-credentials",
        ".npmrc",
        ".claude",
        ".codex",
      ),
      ...under(
        local,
        "Google\\Chrome\\User Data",
        "Microsoft\\Edge\\User Data",
        "BraveSoftware",
        "Microsoft\\Credentials",
      ),
      ...under(
        roaming,
        "Mozilla\\Firefox",
        "Opera Software",
        "Microsoft\\Credentials",
        "Microsoft\\Protect",
      ),
    ],
    readOnly: [get("SystemRoot"), get("ProgramFiles"), get("ProgramFiles(x86)")].filter(
      (p): p is string => Boolean(p),
    ),
  };
}

export function isDevicePath(raw: string): boolean {
  return /^[\\/]{2}[?.][\\/]/.test(raw) || raw.startsWith("\\??\\");
}

/** `.env`, `.env.local`… hold secrets; `.env.example` and the like are fine. */
export function isSecretFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return /^\.env(\..+)?$/.test(name) && !/\.(example|sample|template|dist)$/.test(name);
}

/** The real path, following links, also for paths that don't exist yet. */
function realPath(path: string): string {
  const missing: string[] = [];
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return path;
    missing.unshift(basename(current));
    current = parent;
  }
  try {
    return join(realpathSync.native(current), ...missing);
  } catch {
    return path;
  }
}

function key(path: string): string {
  return win32.normalize(path).replace(/\\+$/, "").toLowerCase();
}

/** Each policy's folders, resolved once: walking a folder tree checks every subfolder. */
const resolvedRoots = new WeakMap<string[], string[]>();

function inside(path: string, roots: string[]): boolean {
  let keys = resolvedRoots.get(roots);
  if (!keys) {
    keys = roots.flatMap((root) => [key(root), key(realPath(root))]);
    resolvedRoots.set(roots, keys);
  }
  const target = key(path);
  return keys.some((r) => target === r || target.startsWith(`${r}\\`));
}

export type PathCheck = { path: string } | { block: PathBlock };

/** Validates a path the agent gave, resolved against `cwd`. */
export function checkPath(
  raw: string,
  cwd: string,
  op: "read" | "write",
  policy: PathPolicy,
): PathCheck {
  if (isDevicePath(raw)) return { block: "device-path" };
  // A colon after the drive letter is an alternate data stream; the rest can't be in a name.
  if (raw.trim() === "" || /[\0<>"|?*]/.test(raw) || raw.slice(2).includes(":"))
    return { block: "invalid-path" };
  const path = win32.resolve(cwd, raw);
  const real = realPath(path);
  if (isSecretFile(path) && op === "read") return { block: "secret-file" };
  if (inside(real, policy.secret) || inside(path, policy.secret))
    return { block: "protected-path" };
  if (op === "write" && (inside(real, policy.readOnly) || inside(path, policy.readOnly)))
    return { block: "protected-path" };
  return { path };
}
