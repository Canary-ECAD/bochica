# S5 — Sessions that survive a restart

**Status:** done
**Goal:** conversations are saved as they happen and come back after a restart; the user can
resume, rename and delete them from the sidebar.

## Decisions

- **SQLite through `node:sqlite`** (built into the Node 24 that Electron 45 ships): no native
  module to rebuild for Electron. Drizzle ORM 0.45 has no `node:sqlite` driver, so queries go
  through Drizzle's `sqlite-proxy` driver over a small `SqlDriver` adapter: `node:sqlite` in the
  app, `bun:sqlite` in tests. Same schema, same queries.
- **Main writes, as the turn happens.** The reducer that turns chat events into a message moves
  to `@bochica/shared` so main and renderer apply exactly the same logic. Main saves the user
  message and an assistant placeholder when a turn starts, after every tool result, and when
  the turn ends; a renderer crash or a closed window loses nothing already streamed.
- A message still `streaming` when the app starts again (crash, forced quit) is marked
  `stopped`. Pending approvals are not saved: a restart denies them, like Stop does.
- Migrations are plain SQL in code, applied in order and tracked with `PRAGMA user_version`;
  no drizzle-kit for now.

## Tasks

### S5-01 · Database and schema

Packages: desktop (main).

- [x] `sessions` (id, title, created_at, updated_at) and `messages` (id, session_id → cascade,
      position, role, content, parts JSON, status, error JSON, created_at) in
      `userData\bochica.db`, with WAL and foreign keys on.
- [x] `SqlDriver` adapter with `node:sqlite` and `bun:sqlite` implementations; Drizzle schema
      and a `SessionRepository` (create, list, get with messages, upsert message, rename, delete
      session, delete messages, mark interrupted turns).
- [x] Migration runner on `PRAGMA user_version`; a test opens an old empty database and migrates.
- [x] Repository tests on `bun:sqlite`: round-trip of parts and errors, ordering, cascade delete,
      interrupted turns.

### S5-02 · One reducer for chat events

Packages: shared, desktop.

- [x] `applyTurnEvent(message, event)` and `toHistory` live in `@bochica/shared`; the renderer
      store and main both use them; the existing store tests move with them.

### S5-03 · Saving turns from main

Packages: shared, desktop (main).

- [x] `chat:send` carries the user message id and text; `ChatService` creates the session on
      its first turn (title from the first message), saves the user message and the placeholder,
      applies every event to its copy and saves after tool results and at the end.
- [x] Retry deletes the failed exchange in the database too.

### S5-04 · Loading, resuming, renaming, deleting

Packages: shared, desktop (preload + renderer).

- [x] IPC: `sessions:list`, `sessions:get`, `sessions:rename`, `sessions:delete`,
      `messages:delete`, validated with Zod.
- [x] On start the sidebar lists saved sessions, newest first; opening one loads its messages.
- [x] Each sidebar row has a "…" menu: **Rename** (inline edit, Enter saves, Esc cancels) and
      **Delete** (confirmation dialog). Deleting the open session goes back to New session.
- [x] Strings in en and es.

## Demo

Ask two questions in two sessions (with the fake model), quit Bochica, start it again: both
sessions are in the sidebar and open with their messages and activity logs. Rename one, delete
the other, restart: the change stuck. Kill Bochica in the middle of an answer: after restart the
partial answer is there, marked as stopped.

## Outcome

Closed 2026-10-27.

- Shipped: `SqlDriver` over `node:sqlite` (app) and `bun:sqlite` (tests) behind Drizzle's
  `sqlite-proxy`; schema and migration runner on `PRAGMA user_version`; `SessionRepository`;
  `applyTurnEvent`, `toHistory` and `titleFrom` moved to `@bochica/shared`; `ChatService`
  saves the user message, the placeholder, every tool call/result, streamed text at most once a
  second and the end of the turn, in strict order; interrupted turns become "stopped" at start;
  session IPC; sidebar rows with rename (inline) and delete (confirmation); saved sessions load
  on demand. Also from the backlog: the New-session heading is now a large greeting that
  changes daily. 169 tests.
- Demo on the built app with the fake model: two sessions survived a restart and reopened with
  their answers and activity logs; rename and delete stuck across a restart (deleting the open
  session returned to New session); killing Bochica mid-answer left the partial text, shown as
  "Stopped" after the restart.
- Found and fixed during the demo: streamed text was only saved at tool results and at the end,
  so a crash mid-answer lost it; it is now saved at most once a second.
- The demo database was deleted afterwards.
