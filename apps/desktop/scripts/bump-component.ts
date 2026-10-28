// Pins an EPLAN component to another commit in components.lock.json. For eplan-mcp it then
// rebuilds the runtime with --lock, which regenerates packages/eplan/requirements.lock.txt and the
// list of the server's tools that the tool policy tests check. The whole procedure is in
// docs/releasing.md.
//
//   bun run components:bump <name> [commit]   (from the repository root)
//
// Without a commit, the head of the repository's default branch is used. A short SHA, a branch
// or a tag also works: GitHub resolves it to the full commit.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ComponentsLock } from "@bochica/eplan";

const desktop = resolve(__dirname, "..");
const lockFile = join(desktop, "..", "..", "components.lock.json");

/** The full SHA GitHub resolves `ref` to in a github.com repository. */
async function resolveCommit(repository: string, ref: string): Promise<string> {
  const repo = repository.replace(/^https:\/\/github\.com\//, "");
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${ref}`, {
    headers: { accept: "application/vnd.github.sha" },
  });
  if (!response.ok) throw new Error(`GitHub doesn't know ${ref} in ${repo} (${response.status}).`);
  return (await response.text()).trim();
}

async function main(): Promise<void> {
  const [name, ref = "HEAD"] = process.argv.slice(2);
  const names = Object.keys(ComponentsLock.shape) as Array<keyof ComponentsLock>;
  const component = names.find((n) => n === name);
  if (!component) throw new Error(`Usage: components:bump <${names.join(" | ")}> [commit]`);

  const lock = ComponentsLock.parse(JSON.parse(readFileSync(lockFile, "utf8")));
  const { repository, commit: old } = lock[component];
  const commit = await resolveCommit(repository, ref);
  if (commit === old) {
    console.log(`${component} is already at ${commit}.`);
    return;
  }
  lock[component] = { repository, commit };
  writeFileSync(lockFile, `${JSON.stringify(ComponentsLock.parse(lock), null, 2)}\n`);
  console.log(`${component}: ${old} → ${commit}`);
  console.log(`What changed: ${repository}/compare/${old}...${commit}`);

  if (component === "eplan-mcp") {
    execFileSync("bun", [join(__dirname, "prepare-runtime.ts"), "--lock"], {
      cwd: desktop,
      stdio: "inherit",
    });
  }
  console.log(
    component === "eplan-mcp"
      ? "Next: git diff packages/eplan/src/fixtures shows every new and removed tool. Classify " +
          "them in packages/eplan/src/tool-policy.ts, then bun run check (see docs/releasing.md)."
      : "Next: bun run check, and try the new skills in the app (see docs/releasing.md).",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
