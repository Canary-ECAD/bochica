import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ComponentsLock } from "./components";
import { defaultMcpServers } from "./mcp-servers";

// The runtime the installer carries: a standalone 64-bit Python with eplan-mcp's dependencies,
// the uv that installed them, eplan-mcp itself and the built-in skills. It is put together by
// apps/desktop/scripts/prepare-runtime.ts and shipped as resources\runtime.

interface PinnedDownload {
  version: string;
  url: string;
  sha256: string;
}

/** python-build-standalone, CPython 3.12 for Windows x64, stripped install-only build. */
export const pythonPin: PinnedDownload = {
  version: "3.12.15+20261013",
  url: "https://github.com/astral-sh/python-build-standalone/releases/download/20261013/cpython-3.12.15%2B20261013-x86_64-pc-windows-msvc-install_only_stripped.tar.gz",
  sha256: "7a2aef48e5ee569e310b29b32681debbc5d888e92790d85331a47736c6b06aad",
};

/** uv for Windows x64. */
export const uvPin: PinnedDownload = {
  version: "0.13.1",
  url: "https://github.com/astral-sh/uv/releases/download/0.13.1/uv-x86_64-pc-windows-msvc.zip",
  sha256: "3b2661a463a5baea7f5076ea2b25ab71d77f36a6c0d809e5350651792f80a672",
};

/** The built-in skill repositories, by their name in components.lock.json. */
export const skillRepositories = ["eplan-scripting-skill", "eec-pro-skill"] as const;

/** Where each part lives inside a runtime folder. */
export function runtimePaths(root: string) {
  return {
    python: join(root, "python", "python.exe"),
    uv: join(root, "uv", "uv.exe"),
    /** Laid out like an eplan-mcp checkout, so the server's script path is the same. */
    eplanMcp: join(root, "eplan-mcp"),
    /** One folder per repository, each with its `skills\` folder, like BOCHICA_SKILLS_DIR. */
    skills: join(root, "skills"),
    manifest: join(root, "manifest.json"),
  };
}

export const RuntimeManifest = z.object({
  python: z.string(),
  uv: z.string(),
  eplanMcp: z.string(),
  skills: z.record(z.string(), z.string()),
  /** SHA-256 of requirements.lock.txt, so a new lock rebuilds the Python environment. */
  requirements: z.string(),
});
export type RuntimeManifest = z.infer<typeof RuntimeManifest>;

/** How to start the local EPLAN server. */
export interface EplanServerLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/**
 * Finds the local EPLAN server. A developer's checkout comes first (BOCHICA_EPLAN_MCP_DIR, with
 * BOCHICA_PYTHON or "python"), then the bundled runtime. A system Python is never used for the
 * bundled server.
 *
 * @param runtimeRoot the bundled runtime folder, or null when there is none.
 * @param logDir where eplan-mcp writes its own logs.
 */
export function eplanServerLaunch(
  env: NodeJS.ProcessEnv,
  runtimeRoot: string | null,
  logDir: string,
): EplanServerLaunch | null {
  const server = defaultMcpServers.find((s) => s.transport === "stdio");
  if (server?.transport !== "stdio") return null;
  // The SDK passes only a minimal environment on, so a custom EPLAN location must be forwarded.
  const platformRoot = env["EPLAN_PLATFORM_ROOT"];
  const common = {
    ...server.env,
    EPLAN_MCP_LOG_DIR: logDir,
    PYTHONUTF8: "1",
    ...(platformRoot ? { EPLAN_PLATFORM_ROOT: platformRoot } : {}),
  };

  const dir = env["BOCHICA_EPLAN_MCP_DIR"];
  if (dir) {
    const script = join(dir, server.script);
    if (!existsSync(script)) return null;
    return { command: env["BOCHICA_PYTHON"] || "python", args: [script], cwd: dir, env: common };
  }

  if (!runtimeRoot) return null;
  const paths = runtimePaths(runtimeRoot);
  const script = join(paths.eplanMcp, server.script);
  if (!existsSync(paths.python) || !existsSync(script)) return null;
  // Packages in the user's own Python folder must never shadow the bundled ones.
  return {
    command: paths.python,
    args: [script],
    cwd: paths.eplanMcp,
    env: { ...common, PYTHONNOUSERSITE: "1" },
  };
}

/**
 * Whether EPLAN is installed, found as eplan-mcp finds it: a version folder under
 * EPLAN_PLATFORM_ROOT (default C:\Program Files\EPLAN\Platform) with the Remote Client in `Bin`.
 */
export function eplanInstalled(env: NodeJS.ProcessEnv): boolean {
  const root =
    env["EPLAN_PLATFORM_ROOT"] ||
    join(env["ProgramFiles"] || "C:\\Program Files", "EPLAN", "Platform");
  try {
    return readdirSync(root).some((name) =>
      existsSync(join(root, name, "Bin", "Eplan.EplApi.RemoteClientu.dll")),
    );
  } catch {
    return false;
  }
}

/** What a runtime built from these pins records in its manifest. */
export function expectedManifest(lock: ComponentsLock, requirements: string): RuntimeManifest {
  return {
    python: pythonPin.version,
    uv: uvPin.version,
    eplanMcp: lock["eplan-mcp"].commit,
    skills: Object.fromEntries(skillRepositories.map((name) => [name, lock[name].commit])),
    requirements,
  };
}
