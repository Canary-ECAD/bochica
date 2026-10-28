# S12 — One-click updater, release process

**Status:** done
**Goal:** an installed Bochica learns that a new version exists, says so without getting in the
way, and updates itself with one click, the EPLAN components included. Publishing that version
is a short, written procedure that ends in a GitHub release built by CI, and bumping an EPLAN
component is one command.

## Decisions

- **`electron-updater` on GitHub Releases**, the provider `electron-builder.yml` already
  declares. Hermes moved its Windows build to MSIX and the OS App Installer, which needs a signed
  package and a feed of its own; Bochica keeps the NSIS installer and the updater that comes
  with it. The download is checked against the SHA-512 in `latest.yml`; the installer isn't
  signed yet, so there is no publisher check (signing is a later decision).
- **One update for everything.** The runtime (Python, eplan-mcp, skills) lives inside the
  installer, so a new release replaces the UI, the agent and the EPLAN components at once. A
  component bump is always a full release. There is no separate dependency sync, so **`uv` no
  longer ships in the app**: the build still uses it, from the download cache, and the manifest
  still records which version built the runtime. The installer gets smaller.
- **Main owns the updater** (`UpdateService`, `main/updates.ts`), behind a small interface so
  it can be tested without Electron. States: `off` (development build), `idle`, `checking`,
  `available`, `downloading` (percent), `ready`, `error`. The renderer reads them with
  `updates:get`, follows `updates:changed`, and asks with `updates:check`, `updates:install`
  and `updates:later`.
- **When it checks:** 30 seconds after start and every 4 hours, and when the user presses
  **Check for updates** in Settings. A check that fails in the background (offline, proxy) is
  only logged; one the user started shows its error.
- **What the user sees:** a notice at the bottom of the sidebar — "Version X is available" —
  with **Update now** and **Later**, and a link to what's new (the release page).
  - **Update now** downloads (progress in the notice) and then restarts into the new version.
    While a task runs, the restart waits: the notice says Bochica will restart when the task
    finishes, and it does so when the last turn ends.
  - **Later** hides the notice for that version and downloads quietly; the update is applied the
    next time Bochica closes (`autoInstallOnAppQuit`). Settings → General says so and has
    **Restart now**.
  - Nothing is installed without one of those two clicks.
- **Failures leave the app as it is.** A failed download or install shows a plain message with
  **Try again**; the installed version keeps working.
- **Clean shutdown before installing.** The installer replaces `resources\runtime`, so the
  bundled `python.exe` must not be running: before installing, and on every quit, main stops the
  turns and waits (at most 5 s) for the MCP servers to close.
- **Testing a feed locally:** `BOCHICA_UPDATE_URL` points the updater at a generic feed (a
  folder with `latest.yml` and the installer). Only `http://127.0.0.1` and `http://localhost`
  are accepted, so it can't be used to slip in a remote feed.
- **Release process:** a tag `vX.Y.Z` that matches `apps/desktop/package.json` runs
  `.github/workflows/release.yml` on `windows-latest`: `bun run check`, then `bun run release`
  (runtime, build, installer) with `--publish always`. electron-builder uploads the installer,
  its blockmap and `latest.yml` to a **draft** release; the maintainer writes the notes and
  publishes it, and only then do installed apps see it. `bun run package` never publishes.
  Written down in `docs/releasing.md`.
- **Bumping a component:** `bun run components:bump <name> [commit]` writes the commit into
  `components.lock.json` (the head of the repository's default branch when none is given). For
  eplan-mcp it rebuilds the runtime with `--lock`, which regenerates `requirements.lock.txt` and
  now also `fixtures/eplan-mcp-tools.txt` from the tools the bundled server lists; then
  `bun run check` names what the tool policy has to classify.

## Tasks

### S12-01 · Update service

Packages: shared, desktop (main).

- [x] `electron-updater` (bundled, devDependency); `UpdateService` with the states above,
      periodic and manual checks, Update now / Later, refusal while a turn runs, and the local
      feed override. Tests with a fake updater.
- [x] IPC: `updates:get`, `updates:check`, `updates:install`, `updates:later`, push
      `updates:changed`.
- [x] Shutdown waits for turns and MCP servers before quitting or installing.

### S12-02 · Notice and Settings

Packages: desktop (renderer).

- [x] Sidebar notice: available (Update now, Later, what's new), downloading (progress),
      ready, waiting for a task, error (Try again). Strings in en and es.
- [x] Settings → General → Updates: current version, state, **Check for updates**,
      **Restart now** when an update waits.

### S12-03 · Release workflow

Packages: desktop (scripts, config), CI, docs.

- [x] `package` never publishes; `release` publishes; `uv` out of the shipped runtime.
- [x] `.github/workflows/release.yml`: tag must match the version; check, build, draft release.
- [x] `docs/releasing.md`: versioning, the steps, what to check on the draft, what to do when
      the workflow fails.

### S12-04 · Component bump

Packages: desktop (scripts), eplan.

- [x] `components:bump`; `prepare-runtime --lock` writes the tools fixture; the procedure in
      `docs/releasing.md`.

### S12-05 · Docs

- [x] README (en, es): updates. CLAUDE.md: updater, release, bump, `uv`. Backlog.

## Demo

Two packaged builds of this code: an older one (`win-unpacked`, version set lower) and a newer
installer served from `127.0.0.1` with its `latest.yml`. The older one, started with
`BOCHICA_UPDATE_URL`, shows the notice; Update now waits while a (fake) turn runs, then
downloads with progress, closes, installs and starts the new version. Later hides the notice and
Settings says the update waits for the next restart. A feed that doesn't answer shows the error
and Try again.

## Outcome

Closed 2026-10-28.

- Shipped: `UpdateService` (`main/updates.ts`) on electron-updater 6.8.11 (`main/updater.ts`),
  with the states, the 30 s / 4 h checks and the local feed override; `updates:*` IPC;
  `ChatService.busy()` / `onIdle`; `McpManager.stop()`, which waits for the servers' processes,
  used before installing and on every quit; the sidebar notice and Settings → Updates (en, es);
  `release` and `components:bump` scripts; `prepare-runtime --lock` writes the tools fixture;
  `.github/workflows/release.yml`; `docs/releasing.md`. Version 0.2.0. 586 tests.
- Decisions taken while building: `uv` no longer ships (the installer went from 168 MB to
  157 MB) and the manifest got a `layout` number so old runtime folders are rebuilt; Update now
  during a task waits instead of being refused; a quiet download after Later that fails just
  offers the update again; the installer name comes from `extraMetadata.name: bochica`, because
  the package name made the install folder `Programs\@bochicadesktop` (found in the demo).
- Demo (packaged builds, Spanish UI, fake LM Studio, feed on `127.0.0.1`): the 0.1.9 build found
  0.2.0 after 30 s and showed the notice; with the feed down, the background check was only
  logged and Settings → Check for updates showed "couldn't check… check your connection or
  proxy" with Try again; Later hid the notice, downloaded quietly and Settings offered Restart
  now; pressed during a running turn, the notice said it would restart when the task ended, and
  it did: the MCP servers stopped, the installer ran silently and Bochica 0.2.0 started from
  `%LOCALAPPDATA%\Programs`, with its bundled Python and the user's data. Closing it left no
  `python.exe` behind. A clean install of the rebuilt installer went to `Programs\bochica`.
  The demo install was removed afterwards.
- Also seen: an installed app checking GitHub with no published release logs "No published
  versions on GitHub" and stays quiet, as intended.
- Release: the `v0.2.0` tag ran the workflow (check, runtime, installer) and uploaded the files,
  but electron-builder's parallel uploads each created a draft, splitting them across two. The
  blockmap was moved into the draft with the installer by hand, and the workflow now creates the
  draft before the uploads. Not verified: an update between two releases published on GitHub.
- Found in passing and fixed: eplan-mcp's port discovery parsed `tasklist` / `netstat` text,
  which is localized, so on a Spanish Windows it failed with `UnicodeDecodeError` (Bochica runs
  Python in UTF-8 mode) and fell back to port 49152; German prints `ABHÖREN` for LISTENING.
  Canary-ECAD/eplan-mcp#74 reads processes and listening ports from the Windows API instead;
  `components:bump eplan-mcp` pinned it (tools and dependency lock unchanged), and the bundled
  runtime found EPLAN's port on this Spanish Windows.
