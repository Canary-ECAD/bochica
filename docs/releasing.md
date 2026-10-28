# Releasing Bochica

How a new version gets from `main` to the people who use Bochica. Written for maintainers.

Installed apps look for updates on GitHub Releases of this repository: 30 seconds after they
start and every 4 hours. They only see **published** releases, never drafts. A user who sees the
notice and presses **Update now** gets the new installer, which replaces everything at once: the
app, the agent and the EPLAN components (Python, eplan-mcp, skills). Nothing installs without
that click, or **Later** (installs the next time Bochica closes).

## Versions

`apps/desktop/package.json` holds the version, `MAJOR.MINOR.PATCH`:

- **Patch** (0.2.0 → 0.2.1): fixes only.
- **Minor** (0.2.x → 0.3.0): a finished sprint, a bumped EPLAN component, anything a user would
  notice.
- **Major**: once Bochica is past 1.0, a change that needs the user to do something.

The tag is the version with a `v`: `v0.3.0`. The release workflow refuses a tag that doesn't
match the file.

## Making a release

1. On an up-to-date `main` with `bun run check` passing, set the new version in
   `apps/desktop/package.json` and commit it: `Release 0.3.0`.
2. Optionally, build it locally first: `bun run package`, then run
   `apps/desktop/release/win-unpacked/Bochica.exe` and try a question in each mode.
3. Tag and push:

   ```bash
   git tag v0.3.0
   ```

   ```bash
   git push origin main v0.3.0
   ```

4. The **release** workflow (`.github/workflows/release.yml`) runs `bun run check`, then
   `bun run release`: the runtime, the build and the installer, uploaded to a **draft** release
   named after the version. It takes about 15 minutes.
5. Open the draft on GitHub and check that it has three files: `Bochica-Setup-0.3.0.exe`, its
   `.blockmap` and `latest.yml`. Write the notes for people who use the app, not for developers:
   what they can do now, what was fixed, and the pinned commits if an EPLAN component changed.
6. **Publish** it. From now on, installed apps offer the update. Their "What's new" link opens
   this release page.

## Trying an update before publishing

The updater can be pointed at a local feed instead of GitHub:

1. Build the new version with `bun run package` and copy `latest.yml`, the installer and its
   blockmap from `apps/desktop/release` into a folder. Rename the installer (and its blockmap) to
   the name `latest.yml` gives (`Bochica-Setup-0.3.0.exe`, with dashes).
2. Serve that folder over HTTP on `127.0.0.1` (any static file server).
3. Start an older build with `BOCHICA_UPDATE_URL=http://127.0.0.1:<port>/`. Only `127.0.0.1` and
   `localhost` are accepted. The older build must come from the NSIS target (`bun run package`,
   or its `win-unpacked`): the updater reads `resources\app-update.yml`, which a `--dir` build
   doesn't have.

The notice appears 30 seconds after start; **Update now** installs into
`%LOCALAPPDATA%\Programs\bochica` like a real update.

## When something goes wrong

- **The workflow fails before uploading:** fix it on `main`, delete the tag
  (`git push --delete origin v0.3.0`, `git tag -d v0.3.0`) and tag again.
- **The workflow fails after creating the draft:** delete the draft on GitHub as well, then tag
  again. A draft is never seen by users, so nothing reached them.
- **A published release is broken:** don't delete it (apps that already downloaded it keep its
  `latest.yml`). Publish a fixed patch release on top; apps move to the newest one.
- **Users report "couldn't reach the update server":** the release is fine; their network or
  proxy blocks `github.com` or `objects.githubusercontent.com`. They can download the installer
  from the release page and run it over the installed app; their settings and sessions stay.

## Bumping an EPLAN component

The EPLAN components are pinned to exact commits in `components.lock.json`, so a change on
another repository's `main` never reaches users by itself. Taking a newer one is a normal
release:

1. Pin it (the head of its default branch, or a given commit, branch or tag):

   ```bash
   bun run components:bump eplan-mcp
   ```

   The script prints the GitHub link that compares the old commit with the new one: read it.

2. **eplan-mcp only.** The script rebuilds the runtime with `--lock`, which regenerates
   `packages/eplan/requirements.lock.txt` (dependencies with hashes) and
   `packages/eplan/src/fixtures/eplan-mcp-tools.txt` (the tools the new server lists).
   `git diff packages/eplan/src/fixtures` shows every added and removed tool. eplan-mcp has no
   safety annotations, so Bochica classifies its tools in `packages/eplan/src/tool-policy.ts`:
   - a new tool that only reads goes to the read tools (runs without asking);
   - one that deletes, closes or restarts things goes to the tools that always ask;
   - anything else can stay unlisted: it asks and makes a backup first, the safe default;
   - a tool the policy names that no longer exists must be removed from its list.
     If a new tool deletes projects or does other bulk-destructive work, add its case to
     `packages/eplan/src/confirmation.ts` (typed confirmation), with a test. Also check whether
     it belongs to the Draw or Tasks mode (`packages/eplan/src/modes.ts`).
3. **Skills.** Nothing else to regenerate; open the app and try a question that uses the skill.
4. `bun run check`. The tool policy tests fail until the lists match the new fixture; update the
   snapshot of how the tools split once the classification is right.
5. Commit the lock with everything it changed (`Bump eplan-mcp to <short sha>`), then make a
   release as above.

Grep the regenerated files for local paths before committing: tools sometimes write absolute
paths into comments.
