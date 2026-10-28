# S10 — Checkpoints, plan mode and permissions

**Status:** active
**Goal:** the user can undo what the agent did to their files by rewinding to an earlier
message; can ask for a plan first and approve it before anything changes; and can decide how
much Bochica asks: rules that never allow a command, "Always allow" for what they trust, an
"Auto" mode for a session, and optional smart approval of harmless commands.

## Decisions

- **Built-in skills, two repositories.** The EEC Pro skill moved out of eplan-scripting-skill
  into [eec-pro-skill](https://github.com/Canary-ECAD/eec-pro-skill). Both are pinned in
  `components.lock.json` and downloaded on their own into `userData\skills\<commit>`; one that
  fails to download doesn't stop the other. `BOCHICA_SKILLS_DIR` now points at a folder that
  holds both checkouts side by side (`eplan-scripting-skill\`, `eec-pro-skill\`). Old caches are
  deleted at start.
- **Permission mode per session**, picked in the composer next to the mode: **Ask** (default),
  **Plan** and **Auto**. It is kept per session in memory only: after a restart every session
  is back to Ask.
- **Plan:** the turn gets only the tools that never ask and never change a project (the same
  filter as helpers), plus the task list, helpers and `bochica__propose_plan`. The prompt says
  to look around, then present the plan with that tool and stop. The plan shows as a card;
  **Go ahead** switches the session back to Ask and sends "Go ahead with the plan."; typing
  anything else keeps planning. Main enforces the tool filter, whatever the model tries.
- **Auto (YOLO):** skips guardrails layer 5 for the session: calls that would ask, risky
  commands included, run straight away. Never skipped: hardline blocks, deny rules, protected
  paths, typed confirmation, tools that always ask by EPLAN policy (closing EPLAN, deleting
  pages), and backups. A red bar stays at the top of the session while it is on, with a button
  to turn it off, which applies at once, even mid-turn. Main keeps the switch (`approvals:set-auto`).
- **Deny rules (layer 3):** glob patterns (`*`, `?`) in Settings → Permissions, matched
  case-insensitively against the whole command and each statement of it, also with aliases
  expanded (`rm` → `Remove-Item`). A match blocks the command before anyone is asked, also in
  Auto mode; the log says it was the user's rule.
- **Always allow:** a third button on cards that offer "Allow for this session" (so never for
  risky, destructive or always-asking calls). For PowerShell it remembers the exact command
  (spaces normalised, case-insensitive); for other tools, the tool. Rules live in
  `userData\permissions.json` and are listed and removable in Settings.
- **Approval history:** main counts how often the user allowed each such command or tool. From
  the third time, the card suggests "You allowed this 3 times. Always allow it?".
- **Smart approvals** (off by default, Settings): before showing a card for a PowerShell command
  with no risk, the turn's model is asked whether it is clearly harmless (reads only, changes
  nothing). Only a clear "yes" runs it; anything else, a failure or 20 s without an answer
  shows the card as usual. Costs a short model call per command.
- **Automatic approvals are visible:** a call allowed by a rule, by smart approval or by Auto
  mode carries `auto` on its result, and the activity log shows why.
- **Checkpoints:** before `write_file` / `edit_file` change a file for the first time in a turn,
  main saves what the file held (or that it didn't exist) in SQLite (migration 4, files up to
  10 MB). Commands and EPLAN changes are not tracked: the rewind dialog says so, and points at
  the EPLAN backup when the session made one.
- **Rewind:** a button on each of the user's messages (not while a turn runs) opens a dialog
  listing the files that would change back, with **Rewind conversation and files**,
  **Conversation only** and **Files only**. Rewinding the conversation deletes that message and
  everything after it, and puts the message back in the composer. Files are restored to the
  state before the first turn that changed them after that point; files that didn't exist are
  deleted.
- **Moved out:** a `/rewind` command, tracking files changed by PowerShell, and per-category
  "Always allow" for file writes inside the working folder → backlog.

## Tasks

### S10-00 · Built-in skills from two repositories

Packages: eplan, desktop (main), docs.

- [x] `components.lock.json` pins `eec-pro-skill` and the new `eplan-scripting-skill` commit;
      `ComponentsLock` requires both.
- [x] `BuiltinSkills` per repository (its own folders and cache); `SkillService` takes several;
      stale caches removed; tests (two sources, one offline).
- [x] README (en, es) and CLAUDE.md name both repositories.

### S10-01 · Permission store and deny rules

Packages: shared, agent, desktop.

- [ ] `PermissionStore` (`permissions.json`): always-allow rules, deny rules, smart switch,
      approval counts; corrupt file set aside; tests.
- [ ] `commandStatements` / `matchesDenyRule` in agent, with a table test (aliases, statements,
      look-alikes that pass); the PowerShell tool blocks a match with `user-rule`.
- [ ] IPC `permissions:get` / `permissions:set`; Settings → Permissions: deny rules (add,
      remove), always-allow list (remove), smart switch. Strings in en and es.

### S10-02 · Always allow, history and automatic approvals

Packages: shared, agent, desktop.

- [ ] `ApprovalDecision` "always"; the card's third button (command or tool wording); main only
      honours it when the request allowed it; approval counts and the suggestion line.
- [ ] Approver answers can be automatic (`rule`, `smart`, `auto`); `tool-result.auto` saved on
      the part; the log shows why. Tests in `tools.test.ts` and `approvals.test.ts`.

### S10-03 · Permission modes: Ask, Plan, Auto

Packages: shared, agent, desktop.

- [ ] Picker in the composer, per session; `approvals:set-auto`; red bar with "Turn off";
      Auto skips what it may and nothing else (tests for each exception).
- [ ] `ChatSendRequest.plan`; plan tool filter and prompt section; `propose_plan` tool; plan
      card with Go ahead; tests for the filter and the prompt.

### S10-04 · Smart approvals

Packages: agent, desktop (main).

- [ ] `judgeCommand(model, command, description)` with a mock model: yes, no, rubbish,
      failure, timeout; only for risk-free PowerShell commands, only when switched on.

### S10-05 · Checkpoints and rewind

Packages: shared, agent, desktop.

- [ ] `AgentTool.writes(input)` on the file tools; `ChatService` saves the first snapshot of
      each file per turn (migration 4); repository tests.
- [ ] `checkpoints:preview` / `checkpoints:rewind`: files restored or deleted, conversation
      cut, refused while a turn runs; tests on a temporary folder.
- [ ] Rewind button and dialog, with the EPLAN / commands note and the backup path; the
      message goes back to the composer. Strings in en and es.

## Demo

With the fake model: in Tasks, the model writes and edits two files; rewinding to the first
message shows both files, "Conversation and files" puts them back and the message is in the
composer. Plan mode: the model gets no write tools, proposes a plan, "Go ahead" switches to Ask
and it carries it out. A deny rule `Remove-Item*` blocks `rm x.txt`. "Always allow" on
`Get-ChildItem` makes the next identical command run with "allowed by your rule" in the log;
after three single allows of another command the card suggests always. Auto mode shows the red
bar and runs a write without a card, but deleting a page still asks. Smart approvals let a
harmless command through when the fake judge says yes.

## Outcome

_To be written when the sprint closes._
