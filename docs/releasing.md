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

To try it without touching an installed Bochica, package both builds under another identity,
which installs into its own folder with its own data (`BochicaTest`):

```bash
cd apps/desktop && bunx electron-vite build
bunx electron-builder --win --publish never -c.appId=com.canary-ecad.bochica.test -c.productName=BochicaTest -c.extraMetadata.name=bochica-test -c.extraMetadata.productName=BochicaTest -c.extraMetadata.version=0.3.1 -c.directories.output=release/old
```

Run it again with the newer version and another output folder; install the older one, serve the
newer one's files and start the older one with the feed variable.

What to look for:

- **Update now** hides the main window behind the small update window, which shows the download
  percent, then "Getting ready to install…" for at least 2.5 s.
- The helper's window takes over at the same place ("Installing…") while the app is gone; no
  installer window shows. The new version opens by itself and the window closes.
- Starting the app from the Start menu during the install brings the update window to the front
  instead of starting a copy; starting it twice otherwise focuses the open window.
- **Later**, then closing the app: the helper's window shows until the installer ends, and the app
  doesn't reopen.
- The helper writes what it did to `%TEMP%\bochica-update-helper.log`; Bochica's log says when it
  didn't start (the installer then shows its own window, as before).

## When something goes wrong

- **The workflow fails before uploading:** fix it on `main`, delete the tag
  (`git push --delete origin v0.3.0`, `git tag -d v0.3.0`) and tag again.
- **"Draft release" fails with `HTTP 500`** (seen with 0.3.1: GitHub refused the workflow's
  token twice while a maintainer's token worked): create the draft yourself,
  `gh release create v0.3.1 --draft --title 0.3.1 --notes ""`, then re-run the workflow. The
  step skips an existing draft and the installer is uploaded to it.
- **The workflow fails after creating the draft:** delete the draft on GitHub as well, then tag
  again. A draft is never seen by users, so nothing reached them.
- **A published release is broken:** don't delete it (apps that already downloaded it keep its
  `latest.yml`). Publish a fixed patch release on top; apps move to the newest one.
- **Users report "couldn't reach the update server":** the release is fine; their network or
  proxy blocks `github.com` or `objects.githubusercontent.com`. They can download the installer
  from the release page and run it over the installed app; their settings and sessions stay.

## Bumping an EPLAN component

The EPLAN components are pinned to exact commits in `components.lock.json`, so a change on
another repository's `main` never reaches users by itself. eplan-mcp publishes tagged releases
(`vX.Y.Z`) whose notes list the tools added, removed or re-annotated; the skills publish none and
are pinned by commit. A scheduled workflow (`.github/workflows/components-watch.yml`, weekly, or
by hand from the Actions tab) opens an issue when eplan-mcp has a release newer than the pin.
Taking a newer version is a normal release:

1. Pin it. eplan-mcp by its release tag (without one, its latest release); the lock records the
   tag next to the commit it names. The skills by commit (without one, the head of their default
   branch):

   ```bash
   bun run components:bump eplan-mcp v1.2.3
   ```

   The script prints the release notes and the GitHub link that compares the old version with
   the new one: read them.

2. **eplan-mcp only.** The script rebuilds the runtime with `--lock`, which regenerates
   `packages/eplan/requirements.lock.txt` (dependencies with hashes) and
   `packages/eplan/src/fixtures/eplan-mcp-tools.json` (the tool contract: every tool the new
   server lists, with its MCP annotations and EPLAN facts). It then prints which tools were
   added, removed or re-annotated, and a `WARNING` line for every tool that used to change
   something and is now read-only: such a tool would run without asking, so check it upstream
   before going on. Bochica decides the policy from the facts (`packages/eplan/src/tool-policy.ts`):
   - read-only and changing nothing → runs without asking;
   - destructive, running code or changing EPLAN itself → asks every time;
   - anything else asks, with a backup first when it changes the project;
   - a tool without annotations asks and gets a backup, the safe default.

   A fact that looks wrong is fixed in eplan-mcp (`mcp_server/tool_annotations.py`) and comes
   with its next release. Only where Bochica deliberately wants something else does a tool go to
   `eplanOverrides`, with its reason. If a new tool deletes projects or does other
   bulk-destructive work, add its case to `packages/eplan/src/confirmation.ts` (typed
   confirmation), with a test. Also check whether it belongs to the Draw or Tasks mode
   (`packages/eplan/src/modes.ts`).

3. **Skills.** Nothing else to regenerate; open the app and try a question that uses the skill.
4. `bun run check`. `tool-policy.test.ts` compares the policy of every pinned tool with
   `packages/eplan/src/fixtures/eplan-tool-policies.json`, reviewed by hand: when a bump changes
   one, check that the change is wanted and update that file in the same commit.
5. Commit the lock with everything it changed (`Bump eplan-mcp to vX.Y.Z`), then make a release
   as above. Close the watch's issue with the commit.

Grep the regenerated files for local paths before committing: tools sometimes write absolute
paths into comments.
