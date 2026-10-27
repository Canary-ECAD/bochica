# S4 — Act on EPLAN

**Status:** done
**Goal:** the agent drives a running EPLAN through the local eplan-mcp server, safely: the user
always sees whether EPLAN is connected, every change asks first, and a project is backed up
before its first change in a session. Starts milestone M1.

Design reference: [guardrails.md](../../design/guardrails.md), layers 5–7.

Facts from eplan-mcp (pinned commit in `components.lock.json`), checked against EPLAN 2026:

- 217 tools over stdio, none with MCP safety annotations, so Bochica classifies them itself.
- `eplan_connect()` with no arguments finds the local instance (~1 s); `eplan_servers` can be
  empty while EPLAN is open, so it is not used to detect EPLAN.
- `eplan_get_current_project` returns `{ success, parameters: { PROJECT: <path> } }`.
- `eplan_backup_project(destination_path, archive_name, project_name, backup_method="BACKUP")`
  makes a copy without touching the source; `project_name` must be passed explicitly.

## Tasks

### S4-01 · Local EPLAN server over stdio

Packages: agent, eplan, desktop (main).

- [x] `McpManager` supports stdio servers (`StdioClientTransport`). The child gets the SDK's
      minimal default environment plus the server's own `env`; API keys are never inherited
      (guardrails layer 7). Its stderr goes to the main log, redacted.
- [x] Dev runtime: `BOCHICA_PYTHON` (default `python`) and `BOCHICA_EPLAN_MCP_DIR` (an
      eplan-mcp checkout) locate the server. Without them the server shows a "not set up"
      state with an explanation instead of an error. Bundling Python stays in S10.
- [x] The EPLAN server is required (always on) and appears in Settings with its status.

### S4-02 · Tool policy for EPLAN

Packages: eplan, agent, shared, desktop.

- [x] Every eplan-mcp tool is classified in `@bochica/eplan`: `read` (never asks), `ask`
      (approval; "Allow for this session" offered) or `always` (approval every time: app
      shutdown/restart, restores, raw actions and scripts, deletes, settings and parts-database
      writes, add-ins). Each non-read tool also says whether it changes a project (needs a
      backup) or only writes files (exports).
- [x] Unknown tools default to `ask` + backup, so new upstream tools are safe by default.
- [x] A test classifies the full list of 217 tool names from the pinned commit and fails if a
      name is missing or a read tool's name suggests a write (`set_`, `delete`, `import`…).
- [x] `always` cards hide "Allow for this session"; the main process enforces it too.

### S4-03 · Backup before the first change

Packages: desktop (main), shared, renderer.

- [x] Before the first project-changing call in a session, Bochica resolves the project (the
      tool's project argument, else the current project), runs `eplan_backup_project` with
      `BACKUP` into `Documents\Bochica\Backups\<project>\<project>-<timestamp>.zw1`, and
      shows it in the activity log as its own step ("Backed up Demo to …").
- [x] If the backup fails, the change does not run; the model and the user are told why.
- [x] Unit tests with a fake EPLAN connection cover: one backup per project per session, a new
      backup for another project, export tools never back up, failure blocks the write.

### S4-04 · EPLAN connection indicator

Packages: desktop.

- [x] Main connects to EPLAN on its own when the server is ready and re-checks every 15 s.
      States: not set up · EPLAN closed · can't connect (EPLAN running: Remote Client is
      probably off) · connected (version).
- [x] The sidebar shows a dot and a short label; clicking it opens a panel with what to do,
      including the Remote Client steps (File → Settings → Workstation → Interfaces → Remote
      access → "Allow remote access via Remote Client").
- [x] Strings in en and es.

### S4-05 · Talking about EPLAN actions

Packages: agent, renderer.

- [x] System prompt: check the connection before acting, ask which project/page when it is not
      obvious, describe results in plain language, never claim a change that a tool did not
      confirm.
- [x] Activity labels for the common EPLAN tools (connect, current project, open/close project,
      search, properties, exports, checks, reports) and a readable fallback for the rest
      ("EPLAN: export dxf pages").

## Demo

With EPLAN open: the sidebar shows "EPLAN 2026 connected". Ask "Which project do I have open?":
it answers without asking for approval. Ask for a PDF export: an approval card appears (no
backup, exports don't change the project). Close EPLAN: the indicator changes within 15 s and
explains what to do.

## Outcome

Closed 2026-10-27.

- Shipped: stdio servers in `McpManager` (SDK minimal env + server env, stderr to the log,
  redacted); per-tool `ToolPolicy` replacing the read-only flag; `eplanToolPolicy` for all 217
  tools (57 never, 120 ask, 40 always; unknown → ask + backup) with a fixture test; `always`
  approvals that can't be allowed for the session (card and main both enforce it);
  `BackupGuard` (one `BACKUP` per project per session into `DocumentsBochicaBackups`, shown
  in the activity log, failure blocks the change); `EplanStatusService` (auto-connect, 15 s
  checks, ping for busy, tasklist to tell closed from Remote Client off); sidebar indicator
  with help panel; EPLAN labels in the activity log and request-form labels for cards;
  system prompt rules for acting on EPLAN. 146 tests.
- Demo on the built app against a real EPLAN 2026, with the fake model issuing the calls:
  the indicator showed "EPLAN 2026 connected"; "which project is open" ran
  `eplan_get_current_project` with no card; a PDF export showed the card (with "Allow for
  this session", as exports are `ask`) and **Deny** kept it from running. Without
  `BOCHICA_EPLAN_MCP_DIR` the indicator shows "EPLAN not set up" with the explanation.
- Found and fixed during the demo: cards reused the activity log's past tense ("Bochica wants
  to: Exported…"); cards now use a request form.
- Deliberately not exercised live: any change to a real project, so the backup guard ran only
  in unit tests; the closed / Remote-Client-off / busy states (unit tests; EPLAN was not
  closed during the demo); a real cloud model choosing EPLAN tools.
- Follow-ups: try a backup + change on a scratch project with a real model; decide whether
  exports should write to a Bochica folder by default.
