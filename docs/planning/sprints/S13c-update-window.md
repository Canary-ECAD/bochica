# S13c — An update you can see from start to finish

**Status:** active
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

- [ ] A frameless window showing the update's step and percent, fed by `updates:changed`, with
      strings in en and es.
- [ ] **Update now**: the main window hides and the update window shows during download,
      preparing (MCP servers stopping) and the hand-off; it stays at least 2.5 s before quitting.
- [ ] A failure closes the update window, brings the main window back and shows the usual error
      with **Try again**.

### S13c-02 · Helper that bridges the install

Packages: desktop (main, `resources`), electron-builder config.

- [ ] A PowerShell helper shipped as an extra resource, copied to a temp folder and started
      detached with an absolute `powershell.exe` path; it shows the same window, waits for the
      old pid (pid + start time), then for the new Bochica window or a timeout.
- [ ] If the helper can't start, the update goes on with the installer's own window.
- [ ] Tests for the arguments and the hand-off decision; a live check on Windows.

### S13c-03 · One instance, and no start mid-update

Packages: desktop (main `index.ts`, `updates.ts`).

- [ ] `requestSingleInstanceLock`: a second launch focuses the existing window.
- [ ] An update marker (pid + start time, in the updater's cache folder) is written before the
      hand-off and removed by the new version; a launch that finds a live marker shows the
      update window and exits. A dead owner's marker is ignored.

### S13c-04 · "Later" and the installer window

- [ ] Install on quit shows the helper's window until the installer ends.
- [ ] The installer's one-click window carries Bochica's name and icon, and Spanish where the
      system is in Spanish, if electron-builder supports it.

### S13c-05 · Docs

- [ ] CLAUDE.md (Updates), `docs/releasing.md` (how to try the window with a local feed), this
      file's outcome.

## Demo

With a local feed (`BOCHICA_UPDATE_URL`) and two builds: **Update now** hides the main window
and shows the update window with the download percent; after the hand-off the same window keeps
showing "Installing…" while the old app is gone; Bochica opens by itself on the new version and
the window closes. Opening Bochica from the desktop during the install shows the update window
instead of a second copy. A failed download brings the main window back with **Try again**.

## Outcome

_To be written when the sprint closes._
