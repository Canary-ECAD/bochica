# S11 — Installer with bundled Python and `uv`, first-run wizard

**Status:** done
**Goal:** a user runs the installer on a clean Windows PC, with no Python, Git or internet
access to GitHub, and Bochica starts with everything it needs: the EPLAN server runs on a
Python that ships inside the app, the built-in skills are there, and a short welcome guide
gets them from "just installed" to a first answer.

## Decisions

- **One runtime folder inside the app.** `bun run package` first runs
  `apps/desktop/scripts/prepare-runtime.ts`, which fills `apps/desktop/runtime/` (not in Git)
  and electron-builder copies it to `resources\runtime`:

  | Folder           | What                                                                        |
  | ---------------- | --------------------------------------------------------------------------- |
  | `python\`        | python-build-standalone CPython 3.12, 64-bit, with eplan-mcp's dependencies |
  | `uv\uv.exe`      | the `uv` that installed them                                                |
  | `eplan-mcp\`     | eplan-mcp's `eplan-p8-mcp-server` at the commit in `components.lock.json`   |
  | `skills\<repo>\` | the skills of each built-in skill repository at its pinned commit           |
  | `manifest.json`  | what was put together: versions and commits, written last                   |

  The layout of `skills\` is the same as `BOCHICA_SKILLS_DIR`, so main reads both the same way.

- **Everything pinned.** Python and `uv` are pinned by version, URL and SHA-256 in
  `packages/eplan/src/runtime.ts`; a download that doesn't match is refused. eplan-mcp's
  `requirements.txt` only says `>=`, so Bochica keeps its own lock with hashes,
  `packages/eplan/requirements.lock.txt`, made by `uv pip compile` for Windows x64 and Python
  3.12 (`bun run --filter @bochica/desktop runtime:lock`). Bumping eplan-mcp means regenerating
  it in the same commit. Packages are installed from wheels only (`--only-binary :all:`) with
  `--require-hashes`.
- **Dependencies go into the bundled Python itself**, not into a virtual environment: a venv
  stores absolute paths and breaks when the app is installed somewhere else. Bytecode is compiled
  at build time, so the first start doesn't write next to the app.
- **`uv` ships but is not run by the app yet.** It builds the environment at package time, and
  the same binary is there for S12, when an update of the EPLAN components alone has to sync
  dependencies into `%LOCALAPPDATA%`. Shipping it now keeps the installer's contents stable.
- **The app never uses a system Python.** Main picks, in order: `BOCHICA_EPLAN_MCP_DIR` (+
  `BOCHICA_PYTHON`) for development, then the bundled runtime (`resources\runtime` when
  packaged, `apps\desktop\runtime` in `bun run dev` once prepared). Nothing else. The server
  gets `PYTHONNOUSERSITE=1` and `PYTHONUTF8=1`, and `EPLAN_MCP_LOG_DIR` under Bochica's logs.
- **Built-in skills from the installer** (backlog). Order: `BOCHICA_SKILLS_DIR`, then the
  bundled copy, then the download (kept for development without either). A built-in skill that
  can't be found shows a plain line in Settings → Skills instead of only a log entry.
- **EPLAN not installed** is a state of its own in the indicator, found the way eplan-mcp
  finds it: a folder under `EPLAN_PLATFORM_ROOT` (default `C:\Program Files\EPLAN\Platform`)
  whose `Bin` holds `Eplan.EplApi.RemoteClientu.dll`. "Not set up" now means a broken install
  and says to reinstall Bochica.
- **First-run wizard**, full window, four steps, every one skippable except the first:
  1. **Welcome:** what Bochica does, the language, the disclaimer.
  2. **Model:** pick a provider, paste the key (the same card as Settings, with the "where do I
     get my key?" link and Test). Continue once a test passes.
  3. **EPLAN:** the live status from the indicator with what to do (install, open EPLAN, turn
     on Remote Client). Bochica works without EPLAN in Consult, so this never blocks.
  4. **Try it:** a sample question in Consult; **Ask it** starts a session with it, **Finish**
     goes to an empty one.

  It is shown while `settings.json` has no `onboarded` flag and no key is configured, so people
  who already use Bochica don't see it after updating. Settings → General has **Show the
  welcome guide again**.

## Tasks

### S11-01 · Runtime pins and the build script

Packages: eplan, desktop (scripts), docs.

- [x] `packages/eplan/src/runtime.ts`: Python and `uv` pins, the runtime layout
      (`runtimePaths`) and the manifest schema; tests.
- [x] `requirements.lock.txt` generated with hashes from the pinned eplan-mcp.
- [x] `scripts/prepare-runtime.ts`: downloads with SHA-256 check and a download cache,
      extracts, copies eplan-mcp and skills at their commits, installs the lock with the bundled
      `uv`, compiles bytecode, writes the manifest; does nothing when the manifest already
      matches. `--lock` regenerates the requirements lock.
- [x] `bun run package` runs it; electron-builder ships `runtime` as `resources\runtime`.

### S11-02 · The app uses the bundled runtime

Packages: eplan, shared, desktop (main, renderer).

- [x] `McpService` finds the bundled Python and server after the dev variables; server
      environment (`PYTHONNOUSERSITE`, `PYTHONUTF8`, `EPLAN_MCP_LOG_DIR`); tests.
- [x] Built-in skills from `resources\runtime\skills`; a missing built-in skill is listed as
      `missing` and Settings says what to do. Strings in en and es.
- [x] `eplanInstalled(env)` and the `not_installed` state, with its label and help; the
      `not_configured` help speaks of reinstalling. Tests.

### S11-03 · First-run wizard

Packages: shared, desktop (main, renderer).

- [x] `onboarding:get` / `onboarding:set` (`settings.json`); shown when not onboarded and no key.
- [x] The four steps, reusing the provider card and the EPLAN status; "Ask it" sends the
      sample question in Consult; Settings → General can show the guide again. Strings in en
      and es.

### S11-04 · Docs

- [x] README (en, es): installing, what the installer contains, building it. CLAUDE.md:
      runtime, wizard, bump procedure. Backlog updated.

## Demo

`bun run package` on a machine without network caches builds the installer with the runtime.
The unpacked build (`release\win-unpacked`), started with an empty user-data folder and with
`BOCHICA_*` variables unset, shows the welcome guide; a key is tested, the EPLAN step shows the
real status, "Ask it" answers the sample question. The EPLAN indicator reaches EPLAN through the
bundled Python (or says EPLAN is closed); Settings → Skills lists both built-in skills without
having downloaded anything.

## Outcome

Closed 2026-10-28.

- Shipped: `packages/eplan/src/runtime.ts` (Python 3.12.15 and uv 0.13.1 pinned by SHA-256,
  `runtimePaths`, `RuntimeManifest`, `eplanServerLaunch`, `eplanInstalled`);
  `requirements.lock.txt` with hashes plus `requirements.constraints.txt`;
  `scripts/prepare-runtime.ts` (`runtime`, `runtime:lock`) run by `bun run package`, shipped as
  `resources\runtime`; built-in skills read from the bundle, `missing` skills shown in Settings;
  the `not_installed` EPLAN state; `onboarding:get` / `onboarding:set` and the four-step welcome
  guide, with "Show again" in Settings. 559 tests.
- Found while building: eplan-mcp's `requirements.txt` says `mcp>=1.8.0`, which now installs mcp
  2.x, where `mcp.server.fastmcp` no longer exists, so a fresh `pip install` of eplan-mcp doesn't
  start. Bochica's lock holds `mcp<2` (1.30.0); eplan-mcp itself should pin it too.
- Decisions taken while building: the Python `Scripts` launchers, Tk, the standard library's
  tests and pip are removed from the bundle (the launchers hold the build machine's paths); the
  runtime folder is emptied rather than deleted, since an open terminal can lock it; the build
  ends by starting the bundled server and requires at least 100 tools; `PYTHONNOUSERSITE` is set
  only for the bundled Python, so a developer's own Python keeps its user packages.
- Size: the runtime is 150 MB on disk; the installer grew to 168 MB.
- Demo on the packaged build (`release\win-unpacked`, empty user-data folder, no `BOCHICA_*`
  variables, Spanish UI, fake LM Studio): the welcome guide showed; LM Studio tested and
  "Ready" appeared; the EPLAN step showed "EPLAN 2026 connected", reached through
  `resources\runtime\python\python.exe`; "Ask it" opened a session in Consult with the sample
  question, the built-in guides in the prompt, and the answer streamed. Settings → Skills listed
  both built-in skills and nothing was downloaded into the user-data folder. "Show again" brought
  the guide back and "Finish" went to an empty session.
- Not verified: installing with the NSIS installer itself (only the unpacked build ran) and a
  machine without EPLAN (`not_installed` is covered by tests).
