// Pins an EPLAN component to another version in components.lock.json. For eplan-mcp it then
// rebuilds the runtime with --lock, which regenerates packages/eplan/requirements.lock.txt and the
// tool contract (fixtures/eplan-mcp-tools.json) the tool policy tests check, and prints how the
// contract changed. The whole procedure is in docs/releasing.md.
//
//   bun run components:bump <name> [ref]   (from the repository root)
//
// `ref` is a release tag (vX.Y.Z, recorded in the lock next to its commit), a commit, a short SHA
// or a branch. Without it, the repository's latest release is used, or the head of its default
// branch if it has none (the skills publish no releases).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ComponentsLock, contractChanges, ToolContract } from "@bochica/eplan";

const desktop = resolve(__dirname, "..");
const lockFile = join(desktop, "..", "..", "components.lock.json");
const contractFile = join(
  desktop,
  "..",
  "..",
  "packages",
  "eplan",
  "src",
  "fixtures",
  "eplan-mcp-tools.json",
);
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

const github = (repository: string) => repository.replace(/^https:\/\/github\.com\//, "");

/** The full SHA GitHub resolves `ref` to in a github.com repository. */
async function resolveCommit(repository: string, ref: string): Promise<string> {
  const repo = github(repository);
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${ref}`, {
    headers: { accept: "application/vnd.github.sha" },
  });
  if (!response.ok) throw new Error(`GitHub doesn't know ${ref} in ${repo} (${response.status}).`);
  return (await response.text()).trim();
}

/** The tag of the repository's latest published release, or null when it has none. */
async function latestRelease(repository: string): Promise<string | null> {
  const response = await fetch(
    `https://api.github.com/repos/${github(repository)}/releases/latest`,
    {
      headers: { accept: "application/vnd.github+json" },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub didn't list the releases (${response.status}).`);
  const { tag_name: tag } = (await response.json()) as { tag_name?: unknown };
  return typeof tag === "string" ? tag : null;
}

function readContract(): ToolContract | null {
  if (!existsSync(contractFile)) return null;
  return ToolContract.parse(JSON.parse(readFileSync(contractFile, "utf8")));
}

/** Prints what changed in eplan-mcp's tool contract; a tool that became read-only stands out. */
function printContractChanges(before: ToolContract | null, after: ToolContract | null): void {
  if (!after) throw new Error("prepare-runtime --lock wrote no tool contract.");
  if (!before) {
    console.log(`Tool contract: ${after.tools.length} tools (no previous contract to compare).`);
    return;
  }
  const changes = contractChanges(before, after);
  console.log(
    `Tools: ${changes.added.length} added, ${changes.removed.length} removed, ` +
      `${changes.reannotated.length} re-annotated.`,
  );
  for (const name of changes.added) console.log(`  + ${name}`);
  for (const name of changes.removed) console.log(`  - ${name}`);
  for (const { name, changes: what } of changes.reannotated) {
    console.log(`  ~ ${name}: ${what.join("; ")}`);
  }
  for (const name of changes.nowReadOnly) {
    console.log(
      `WARNING: ${name} used to change something and is now read-only: it will run without asking.`,
    );
  }
}

async function main(): Promise<void> {
  const [name, requested] = process.argv.slice(2);
  const names = Object.keys(ComponentsLock.shape) as Array<keyof ComponentsLock>;
  const component = names.find((n) => n === name);
  if (!component) throw new Error(`Usage: components:bump <${names.join(" | ")}> [tag or commit]`);

  const lock = ComponentsLock.parse(JSON.parse(readFileSync(lockFile, "utf8")));
  const { repository, commit: old, tag: oldTag } = lock[component];
  const ref = requested ?? (await latestRelease(repository)) ?? "HEAD";
  const tag = RELEASE_TAG.test(ref) ? ref : undefined;
  const commit = await resolveCommit(repository, ref);
  if (commit === old && tag === oldTag) {
    console.log(`${component} is already at ${tag ?? commit}.`);
    return;
  }
  lock[component] = { repository, commit, ...(tag ? { tag } : {}) };
  writeFileSync(lockFile, `${JSON.stringify(ComponentsLock.parse(lock), null, 2)}\n`);
  console.log(`${component}: ${oldTag ?? old} → ${tag ? `${tag} (${commit})` : commit}`);
  if (tag) console.log(`Release notes: ${repository}/releases/tag/${tag}`);
  else if (component === "eplan-mcp")
    console.log("Note: not a release tag, so the lock records no tag.");
  console.log(`What changed: ${repository}/compare/${oldTag ?? old}...${tag ?? commit}`);

  if (component === "eplan-mcp") {
    const before = readContract();
    execFileSync("bun", [join(__dirname, "prepare-runtime.ts"), "--lock"], {
      cwd: desktop,
      stdio: "inherit",
    });
    printContractChanges(before, readContract());
  }
  console.log(
    component === "eplan-mcp"
      ? "Next: bun run check. If a tool's policy changed, review it in " +
          "packages/eplan/src/fixtures/eplan-tool-policies.json (see docs/releasing.md)."
      : "Next: bun run check, and try the new skills in the app (see docs/releasing.md).",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
