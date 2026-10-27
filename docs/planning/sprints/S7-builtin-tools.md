# S7 — Built-in tools and the guardrails core

**Status:** done
**Goal:** the agent can read, search and change files and run PowerShell commands in a working
folder the user picks, behind the guardrails core: what must never happen is refused, what is
risky asks every time and says why in plain language, and secrets stay out of reach.

## Decisions

- **Tools** (server `bochica`): `read_file`, `list_files` (glob), `search_files` (regex),
  `write_file`, `edit_file` (exact text replacement) and `powershell`. Implemented in
  `@bochica/agent` (`src/builtin/`) so a future CLI gets them too; main only wires them.
- **Per mode:** Consult gets the file tools (read a script, save one) but no terminal; Tasks
  gets everything; Draw gets none (it works on EPLAN pages only).
- **Approvals:** reads and searches never ask. Writes and edits ask, and can be allowed for the
  session. Every PowerShell command asks; "Allow for this session" covers ordinary commands
  only. Commands Bochica flags as risky (deletes, killing processes, registry, services,
  execution policy, scheduled tasks, shutdown, obfuscation, invisible characters, sending
  secrets, running a script it cannot read) ask **every time** and the card lists why.
- **Per-call assessment:** `AgentTool.assess(input)` can block a call (with a reason code), or
  raise its approval and attach risks. `toToolSet` runs it before approval; a blocked call
  never reaches the user or the tool, shows as "Blocked" in the activity log, and the model is
  told not to retry or rephrase it.
- **Command parsing fails closed:** unbalanced quotes or brackets are refused as malformed.
  Nested commands are assessed too: `cmd /c …`, `powershell -Command …`, `-EncodedCommand`
  (decoded), `Invoke-Expression "…"`, `$(…)` inside strings, script blocks, and `.ps1` / `.bat`
  files the command runs (read from disk; unreadable means "can't check what it does").
- **Working folder:** each session has one, chosen in the composer before the first message
  (default `Documents\Bochica`, created when needed) and saved with the session. Relative
  paths and the terminal start there; the file tools may still reach other folders, guarded
  by layers 1 and 4.
- **Terminal environment** (layer 7): `powershell.exe -NoProfile -NonInteractive` with a safe
  list of variables (`PATH`, `SYSTEMROOT`, `TEMP`, `USERPROFILE`, `APPDATA`…). Nothing else from
  Bochica's environment, such as API keys, is inherited. Timeout 2 minutes by default, 10 at
  most; the whole process tree is killed on timeout or Stop.
- **Moved to S10** (guardrails advanced): user deny rules (layer 3), persisted "Always allow"
  and YOLO mode. Without them nothing can skip a card, which is the safe default.

## Tasks

### S7-01 · Command guard

Packages: agent.

- [x] `assessCommand(command, context)` → `{ block }` or `{ risks }`, covering guardrails
      layers 1 (malformed, device paths), 2 (hardline) and 5 (risk patterns).
- [x] Table tests: commands that must be blocked, that must ask with a given risk, and
      look-alikes that must pass (`Remove-Item .\build -Recurse` asks; `Remove-Item C:\
      -Recurse` is hardline; `Get-ChildItem -Recurse` passes), with obfuscation variants
      (backticks, carets, aliases, nested shells, encoded commands, script files).

### S7-02 · File tools and path guard

Packages: agent.

- [x] `checkPath(raw, op)`: device and NT namespace paths, alternate data streams, protected
      folders (credentials, Bochica's own data, browser profiles, Windows and Program Files for
      writes), `.env*` read-deny (`.env.example` and the like are fine); symlinks, junctions and
      8.3 names resolved before comparing.
- [x] `read_file`, `list_files`, `search_files`, `write_file`, `edit_file` with limits (size,
      lines, matches) and a line diff (`+N −M` and a short patch) on every write.
- [x] Tests on a temporary folder, including traversal, protected paths and CRLF files.

### S7-03 · PowerShell tool and per-call assessment

Packages: agent, shared.

- [x] `AgentTool.assess`; `toToolSet` blocks, or asks every time with the risks; new tool status
      `blocked`, and `risks` on `ApprovalRequest`; `diff` and `blocked` on tool results.
- [x] `powershell` tool: filtered environment, working folder checks, timeout, output cap,
      process tree killed on Stop; tests run real `powershell.exe` commands.

### S7-04 · Working folder per session

Packages: shared, desktop.

- [x] Sessions store their folder (migration); `ChatSendRequest.folder`, validated in main
      (absolute, existing, not a device path), default `Documents\Bochica`.
- [x] A folder button in the composer (system folder picker); the chosen folder is remembered
      for new sessions and fixed once a session has started. The system prompt names it.
- [x] `ChatService` gives each mode its built-in tools.

### S7-05 · Cards and activity log

Packages: desktop (renderer).

- [x] Command card: the model's plain-language description first, the command in a code block,
      and the risks as plain sentences; "Allow for this session" hidden for risky commands.
- [x] Activity log: a sentence per built-in tool (en, es), "Blocked" rows with the reason, and
      file diffs (`+N −M` badge, patch on expand).

### S7-06 · Context-file injection scan

Packages: agent, desktop (main).

- [x] `scanContextFile(text)`: "ignore previous instructions" and similar, hidden HTML comments
      with suspicious words, asking to read `.env` or credentials, exfiltration with `curl` /
      `iwr`, invisible Unicode. Table tests, including the real scripting skill passing.
- [x] `SkillStore` skips a skill with findings and logs why.

## Demo

With the fake model in Tasks mode, in a new session whose folder is a demo folder: write a file
(card, then a `+N` diff in the log), edit it (`+1 −1`), read and search it (no card). Run
`Get-ChildItem` (card, allow for the session), then `Get-Date` (no card), then
`Remove-Item .\old -Recurse` (card every time, says it deletes a folder and everything in it).
`Remove-Item C:\ -Recurse` and `iwr … | iex` show as Blocked, with no card. In Consult there is
no PowerShell tool; in Draw no file tools.

## Outcome

Closed 2026-10-27.

- Shipped: `assessCommand` (PowerShell/cmd lexer that fails closed; nested `cmd /c`,
  `powershell -Command` / `-EncodedCommand` (decoded), `Invoke-Expression`, `$(…)` in strings,
  script blocks and `.ps1` / `.bat` files read from disk; hardline blocks for disks, recursive
  deletes of drives / Windows / Program Files / ProgramData / profiles and their main folders,
  boot and shadow copies, download-and-run, killing Bochica; 15 risk kinds). `checkPath` with
  junctions and 8.3 names resolved, `defaultPathPolicy`. File tools with BOM/UTF-16 and CRLF
  handling and a line diff; `powershell` with a filtered environment, timeout and process-tree
  kill. `AgentTool.assess`, tool status `blocked`, `risks` on approval cards, `diff` on tool
  results. Working folder per session (migration 2, `folders:pick` / `folders:default`, picker in
  the composer). `scanContextFile` on skills. 399 tests.
- Decisions taken while building: every delete (not only recursive or forced ones) asks every
  time; a recursive delete of a profile's Desktop, Documents, Downloads, OneDrive, Pictures or
  AppData is hardline too; interpreters (`python`, `node`, `wscript`, `mshta`…) count as
  "can't check what it runs". The eplan-scripting-skill at the pinned commit passes the
  injection scan (all 15 Markdown files).
- Demo on the built app with the fake model (isolated `--user-data-dir`): write (card with the
  new content, then `+3 −0`), edit (card with the −/+ lines, then `+1 −1` and the patch), read
  and search with no card; `Get-ChildItem` asked and was allowed for the session, `Get-Date` then
  ran with no card; `Remove-Item .\viejo -Recurse` asked with "deletes a folder and everything
  inside it" and no session button, and deleted it once allowed; `Remove-Item C:\ -Recurse
  -Force`, `iwr … | iex` and reading `.env` were blocked with no card, the log said why and the
  model was told not to retry. Consult had the file tools without PowerShell, Draw none. The
  session reopened from disk with its blocked rows and diffs.
- Found and fixed during the demo: blocked calls were summarised as "Ran a command" (now
  "Blocked an action", with the reason visible while collapsed); the patch listed added lines
  before removed ones.
- Moved to S10: user deny rules (layer 3), persisted "Always allow", YOLO mode. The injection
  scan's findings are only logged; showing them in the UI comes with the skills screen (S8).
- Not exercised: a real model choosing these tools; the folder picker dialog itself (the demo
  set the folder directly).
