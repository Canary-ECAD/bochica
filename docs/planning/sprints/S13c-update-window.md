# S13c — An update you can see from start to finish

**Status:** done
**Goal:** from **Update now** until the new version opens, the user always sees a small Bochica
window that says it is updating and that Bochica will open by itself. Nothing looks like a
crash, and opening Bochica again in the middle neither starts a second copy nor breaks the
update.

## Why

Seen with 0.3.0 → 0.3.1: after **Update now** every window closed and nothing showed for about a
minute while the installer ran (silently in 0.3.0; 0.3.1 shows the installer's own progress
window, which is plain and appears only after a gap). A user who thinks Bochica crashed opens it
again, mid-update. Bochica has no single-instance lock either, so that starts a second copy
next to the installer.

## Decisions

- **Same idea as Hermes** (checked in `apps/desktop/electron/update-gate.ts` and
  `updater/relaunch-waiter.ts`, November 2026; check again before copying):
  - before quitting, it keeps an "updating, don't reopen" message on screen for about 2.5 s
    (`UPDATE_HANDOFF_DWELL_MS`) so the user can read it, then hands over;
  - a small helper process staged outside the app's folder (a PowerShell script shipped as an
    extra resource, run with an absolute `powershell.exe` path) waits for the old process to exit
    and bridges until the new version is up;
  - an on-disk marker, with its owner's pid and start time so a dead updater never blocks, tells
    a relaunch that an update owns the app right now.
- **The update window** is a small frameless window (about 360 × 160, centered, always on top,
  no taskbar entry of its own while the main window lives): Bochica's icon, "Updating Bochica to
  X.Y.Z", the step (downloading with percent, preparing, installing) and "Bochica will open by
  itself; you don't need to do anything". The main window hides behind it as soon as **Update
  now** has a download ready; it comes back if anything fails.
- **The app must exit for the installer to replace it**, so the update window can't live
  through the install. The bridge is the helper process: before quitting, main starts it
  detached; it shows the same window (WinForms from PowerShell, same text and icon, strings
  passed by main in the user's language), waits for Bochica to exit, waits for the installer,
  and closes when the new Bochica's window is up (or after a timeout with a plain message). The
  installer stays non-silent in case the helper can't start.
- **One Bochica at a time:** `app.requestSingleInstanceLock()`. A second launch focuses the
  running window, or, while an update is running (marker alive), shows the update window and
  exits instead of starting.
- **"Later" gets the same treatment** when it installs on quit: the helper shows the window
  until the new version is installed (it doesn't reopen Bochica, since the user closed it).
- **The installer's own window** (NSIS one-click) says "Bochica" and uses the user's language
  where electron-builder allows it, for the case where the helper doesn't run.

## Tasks

### S13c-01 · Update window in the app

Packages: shared (`UpdateStatus`), desktop (main `updates.ts`, a new window, renderer route).

- [x] A frameless window showing the update's step and percent, fed by `updates:changed`, with
      strings in en and es.
- [x] **Update now**: the main window hides and the update window shows during download,
      preparing (MCP servers stopping) and the hand-off; it stays at least 2.5 s before quitting.
- [x] A failure closes the update window, brings the main window back and shows the usual error
      with **Try again**.

### S13c-02 · Helper that bridges the install

Packages: desktop (main, `resources`), electron-builder config.

- [x] A PowerShell helper shipped as an extra resource, copied to a temp folder and started
      detached with an absolute `powershell.exe` path; it shows the same window, waits for the
      old pid (pid + start time), then for the new Bochica window or a timeout.
- [x] If the helper can't start, the update goes on with the installer's own window.
- [x] Tests for the arguments and the hand-off decision; a live check on Windows.

### S13c-03 · One instance, and no start mid-update

Packages: desktop (main `index.ts`, `updates.ts`).

- [x] `requestSingleInstanceLock`: a second launch focuses the existing window.
- [x] An update marker (pid + start time, in the updater's cache folder) is written before the
      hand-off and removed by the new version; a launch that finds a live marker shows the
      update window and exits. A dead owner's marker is ignored.

### S13c-04 · "Later" and the installer window

- [x] Install on quit shows the helper's window until the installer ends.
- [x] The installer's one-click window carries Bochica's name and icon, and Spanish where the
      system is in Spanish, if electron-builder supports it.

### S13c-05 · Docs

- [x] CLAUDE.md (Updates), `docs/releasing.md` (how to try the window with a local feed), this
      file's outcome.

## Demo

With a local feed (`BOCHICA_UPDATE_URL`) and two builds: **Update now** hides the main window
and shows the update window with the download percent; after the hand-off the same window keeps
showing "Installing…" while the old app is gone; Bochica opens by itself on the new version and
the window closes. Opening Bochica from the desktop during the install shows the update window
instead of a second copy. A failed download brings the main window back with **Try again**.

## Outcome

Done on 2026-11-05. Checked live on Windows with two packaged builds under a test identity
(`BochicaTest`, so the installed Bochica was untouched) and a local feed:

- **Update now:** the main window hid and the update window showed the download percent, in
  Spanish; the helper's window took over about a second later, the silent install ran for about
  100 s and 0.3.2 opened by itself, removed the marker and the helper's window closed.
- **Opening Bochica mid-install** exited within a second without a second copy (logged as "An
  update is being installed"), and the helper's window came to the front. A second launch
  outside an update exits too and focuses the open window.
- **Later, then closing the app:** the helper's window stayed until the installer's process ended
  (seen and waited for) and Bochica didn't reopen.
- The helper's temporary folders were all gone afterwards; only its log stays in `%TEMP%`.

Differences from the plan, and why:

- **Hermes checked again before building the helper** (`updater/relaunch-waiter.ts`,
  `updater-process.ts`, `update-gate.ts`), which changed how it starts: Windows PowerShell 5.1
  spawned `detached` exits before running a line of `-File`, so the helper runs as
  `cmd.exe /d /s /c powershell.exe -File …`, hidden and not detached (PowerShell, a grandchild,
  outlives Bochica); its working folder is `%TEMP%`, since a working folder can't be removed and
  the installer replaces the app's; main waits for a `ready.txt` the script writes once its window
  shows (10 s) and otherwise stops the tree with `taskkill /T`; the script logs each attempt to
  `%TEMP%\bochica-update-helper.log`, and main copies this attempt's lines into its own log when the
  helper fails.
- **The install is silent when the helper's window is up** (`quitAndInstall(true, true)`), so only
  one window shows; the NSIS window remains the fallback. Install on quit was already silent.
- **The helper owns the marker,** not the old app: it writes its own pid and start time when its
  window shows, so the marker is alive exactly while that window is. It lives in `userData`
  (`update-marker.json`), not the updater's cache folder: main knows that path before the app
  is ready. The new version tells the helper it is up by removing the marker; a launch of another
  version creates `update-marker.json.poke` to bring the helper's window forward.
- **The update window is a renderer page of its own** (`update.html`), not a route: it starts
  fast and loads nothing of the app. It has a taskbar entry (Bochica's) while the main window is
  hidden; the helper's window has none, because there it showed PowerShell's icon.
- **A task running at "Update now" keeps the main window:** `waiting` is set from the click, and
  the update window only shows once the task has ended.
- **The NSIS installer** already uses productName, the app's icon and Windows' language:
  electron-builder bundles every NSIS language unless `installerLanguages` narrows them. Nothing
  to change; electron-builder.yml says so.
- Not checked live: a failed download bringing the main window back (covered by the
  `showsUpdateWindow` tests and the existing error states), and a helper blocked by policy
  (falls back to the installer's window after the 10 s handshake).
