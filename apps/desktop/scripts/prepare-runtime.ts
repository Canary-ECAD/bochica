// Puts together apps/desktop/runtime, which the installer ships as resources\runtime: the
// standalone Python with eplan-mcp's dependencies, uv, eplan-mcp and the built-in skills, each at
// its pinned version. Run by `bun run package`; does nothing when the runtime is up to date.
//
//   bun scripts/prepare-runtime.ts          build (or check) the runtime
//   bun scripts/prepare-runtime.ts --lock   regenerate packages/eplan/requirements.lock.txt
//                                           from the pinned eplan-mcp first

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { McpManager, readOnlyPolicy } from "@bochica/agent";
import {
  componentsLock,
  eplanServerLaunch,
  expectedManifest,
  pythonPin,
  RuntimeManifest,
  runtimePaths,
  skillRepositories,
  uvPin,
} from "@bochica/eplan";

const desktop = resolve(__dirname, "..");
const root = join(desktop, "runtime");
const paths = runtimePaths(root);
const cache = join(desktop, ".cache");
const repoRoot = resolve(desktop, "..", "..");
const eplanPackage = join(repoRoot, "packages", "eplan");
const lockFile = join(eplanPackage, "requirements.lock.txt");
const constraintsFile = join(eplanPackage, "requirements.constraints.txt");
/** Windows' own bsdtar: unlike Git's tar it also reads zip files and drive-letter paths. */
const tar = join(process.env["SystemRoot"] || "C:\\Windows", "System32", "tar.exe");
/** Fewer tools than this means the server didn't load its actions. */
const MIN_TOOLS = 100;

function log(line: string): void {
  console.log(`[runtime] ${line}`);
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function run(
  command: string,
  args: string[],
  env: Record<string, string> = {},
  cwd: string = desktop,
): string {
  return execFileSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/**
 * Downloads `url` into the cache, or reuses the cached copy. With `sha256` the file must match
 * it; without, the cache name must already identify the content (a commit).
 */
async function download(url: string, name: string, expected?: string): Promise<string> {
  const file = join(cache, "downloads", name);
  if (existsSync(file) && (!expected || sha256(readFileSync(file)) === expected)) return file;
  log(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (expected && sha256(data) !== expected)
    throw new Error(`${url} doesn't match its pinned SHA-256; refusing to use it.`);
  mkdirSync(join(cache, "downloads"), { recursive: true });
  writeFileSync(file, data);
  return file;
}

/** Extracts an archive into a new temporary folder and returns it. */
function extract(archive: string, stripComponents = 0): string {
  const target = mkdtempSync(join(tmpdir(), "bochica-runtime-"));
  run(tar, ["-xf", archive, "-C", target, `--strip-components=${stripComponents}`]);
  return target;
}

/** A GitHub repository at a commit, extracted; the caller removes the folder. */
async function checkout(name: keyof typeof componentsLock): Promise<string> {
  const { repository, commit } = componentsLock[name];
  const repo = repository.replace(/^https:\/\/github\.com\//, "");
  const archive = await download(
    `https://codeload.github.com/${repo}/tar.gz/${commit}`,
    `${name}-${commit}.tar.gz`,
  );
  return extract(archive, 1);
}

async function prepareUv(): Promise<void> {
  const folder = extract(await download(uvPin.url, `uv-${uvPin.version}.zip`, uvPin.sha256));
  mkdirSync(join(root, "uv"), { recursive: true });
  cpSync(join(folder, "uv.exe"), paths.uv);
  rmSync(folder, { recursive: true, force: true });
}

async function prepareEplanMcp(): Promise<void> {
  const folder = await checkout("eplan-mcp");
  const server = "eplan-p8-mcp-server";
  cpSync(join(folder, server), join(paths.eplanMcp, server), {
    recursive: true,
    filter: (path) => !/[\\/](tests|Testing)$/.test(path),
  });
  cpSync(join(folder, "LICENSE"), join(paths.eplanMcp, "LICENSE"));
  rmSync(folder, { recursive: true, force: true });
}

async function prepareSkills(): Promise<void> {
  await Promise.all(
    skillRepositories.map(async (name) => {
      const folder = await checkout(name);
      const target = join(paths.skills, name);
      cpSync(join(folder, "skills"), join(target, "skills"), { recursive: true });
      cpSync(join(folder, "LICENSE"), join(target, "LICENSE"));
      rmSync(folder, { recursive: true, force: true });
    }),
  );
}

/**
 * Rewrites requirements.lock.txt from the pinned eplan-mcp's requirements, with hashes. Run from
 * the repository root with relative paths, so the "via" notes in the lock name no local folder.
 */
function writeLock(): void {
  const requirements = join(
    paths.eplanMcp,
    "eplan-p8-mcp-server",
    "mcp_server",
    "requirements.txt",
  );
  log("regenerating requirements.lock.txt");
  const fromRoot = (path: string) => relative(repoRoot, path).replaceAll("\\", "/");
  run(
    paths.uv,
    [
      "pip",
      "compile",
      fromRoot(requirements),
      "--constraint",
      fromRoot(constraintsFile),
      "--python-version",
      "3.12",
      "--python-platform",
      "x86_64-pc-windows-msvc",
      "--only-binary",
      ":all:",
      "--generate-hashes",
      "--no-header",
      "--quiet",
      "--output-file",
      fromRoot(lockFile),
    ],
    {},
    repoRoot,
  );
}

async function preparePython(): Promise<void> {
  const archive = await download(
    pythonPin.url,
    `cpython-${pythonPin.version}.tar.gz`,
    pythonPin.sha256,
  );
  run(tar, ["-xf", archive, "-C", root]);
  log("installing eplan-mcp's dependencies");
  run(
    paths.uv,
    [
      "pip",
      "install",
      "--python",
      paths.python,
      "--break-system-packages",
      "--require-hashes",
      "--only-binary",
      ":all:",
      "--requirements",
      lockFile,
    ],
    { UV_CACHE_DIR: join(cache, "uv"), UV_PYTHON_DOWNLOADS: "never", UV_NO_CONFIG: "1" },
  );
  run(paths.uv, ["pip", "uninstall", "--python", paths.python, "--break-system-packages", "pip"], {
    UV_NO_CONFIG: "1",
  });
  // What the server never uses: Tk, the standard library's tests, pip (uv installs), C headers,
  // and the command launchers in Scripts, which point at this build machine's paths.
  const python = join(root, "python");
  for (const unused of [
    "tcl",
    "include",
    "Scripts",
    join("Lib", "test"),
    join("Lib", "idlelib"),
    join("Lib", "tkinter"),
    join("Lib", "turtledemo"),
    join("Lib", "ensurepip"),
    join("DLLs", "_tkinter.pyd"),
    join("DLLs", "tcl86t.dll"),
    join("DLLs", "tk86t.dll"),
  ])
    rmSync(join(python, unused), { recursive: true, force: true });
  // Unchecked hashes: the files keep working whatever timestamps the installer gives them, and
  // Python never tries to write next to the app.
  log("compiling bytecode");
  run(paths.python, [
    "-m",
    "compileall",
    "-q",
    "-j",
    "0",
    "--invalidation-mode",
    "unchecked-hash",
    join(root, "python", "Lib"),
    paths.eplanMcp,
  ]);
}

/** Starts the bundled server as the app does and checks that it lists its tools. */
async function smokeTest(): Promise<void> {
  const logDir = mkdtempSync(join(tmpdir(), "bochica-runtime-logs-"));
  // Only the bundled server: a developer's checkout in the environment must not stand in for it.
  const { BOCHICA_EPLAN_MCP_DIR: _dir, ...env } = process.env;
  const launch = eplanServerLaunch(env, root, logDir);
  if (!launch) throw new Error("The runtime has no Python or no eplan-mcp server.");
  const manager = new McpManager();
  try {
    const tools = await new Promise<number>((done, fail) => {
      const timer = setTimeout(() => fail(new Error("The server didn't start in 60 s.")), 60_000);
      manager.onChange(() => {
        const state = manager.states()[0];
        if (state?.state === "ready") done(state.toolCount);
        if (state?.state === "error") fail(new Error(`The server failed: ${state.error ?? ""}`));
        if (state?.state === "ready" || state?.state === "error") clearTimeout(timer);
      });
      manager.configure([
        {
          config: {
            id: "eplan",
            transport: "stdio",
            ...launch,
            required: true,
            policy: readOnlyPolicy,
          },
          enabled: true,
        },
      ]);
    });
    if (tools < MIN_TOOLS) throw new Error(`The server listed only ${tools} tools.`);
    log(`the bundled server lists ${tools} tools`);
  } finally {
    await manager.close();
    rmSync(logDir, { recursive: true, force: true });
  }
}

/** The manifest this build should end up with; read again after `--lock` rewrote the lock. */
function want(): RuntimeManifest {
  return expectedManifest(componentsLock, sha256(readFileSync(lockFile)));
}

async function main(): Promise<void> {
  const relock = process.argv.includes("--lock");
  if (!relock && existsSync(paths.manifest)) {
    const have = RuntimeManifest.safeParse(JSON.parse(readFileSync(paths.manifest, "utf8")));
    if (have.success && JSON.stringify(have.data) === JSON.stringify(want())) {
      log("up to date");
      return;
    }
  }

  // Emptied rather than deleted: an open terminal or editor may hold the folder itself.
  mkdirSync(root, { recursive: true });
  for (const entry of readdirSync(root))
    rmSync(join(root, entry), { recursive: true, force: true });
  await prepareUv();
  await prepareEplanMcp();
  if (relock) writeLock();
  await preparePython();
  await prepareSkills();
  await smokeTest();
  // Written last: a build cut short is redone from scratch next time.
  writeFileSync(paths.manifest, JSON.stringify(want(), null, 2));
  log(`ready in ${root}`);
}

main().catch((error: unknown) => {
  console.error(`[runtime] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
