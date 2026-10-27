# S8 — Skills, slash commands and `@file` mentions

**Status:** done
**Goal:** users can add their own skills and see which ones Bochica loaded (and why one was
left out), call a skill or an app command by typing `/`, and point the agent at a file of the
working folder by typing `@`.

## Decisions

- **Skill format:** the agentskills.io format, as in eplan-scripting-skill: a folder with a
  `SKILL.md` whose front matter has `name` (lowercase letters, digits and hyphens, at most 64
  characters) and `description` (at most 1024 characters); other fields are kept but ignored
  for now (`allowed-tools` included). Parsing, validation and the skill tools live in
  `@bochica/agent` (`skills.ts`) so a future CLI gets them too.
- **Two sources.** _Built in_: the EPLAN scripting skills (P8 and EEC Pro), downloaded at the
  pinned commit as in S6; in Consult their whole guide stays in the system prompt, as before.
  _Added by the user_: copied from a folder the user picks in Settings into
  `userData\skills\user\<name>` (Bochica's own data, which the file tools can't touch, so the
  agent can't write its own skills). A folder with a `SKILL.md` is one skill; a folder whose
  subfolders have one is several. A skill with the same name replaces the old copy. Limits:
  200 files and 5 MB per skill.
- **Progressive disclosure** for added skills: only name and description go into the prompt,
  in every mode; `bochica__use_skill(name)` returns the instructions and the list of reference
  files, which `bochica__read_skill_file` opens (now for any skill, paths `<skill id>/…`). Both
  are read-only and never ask. Skills only add instructions: the mode still decides the tools.
- **Injection scan** (guardrails layer 8) on every Markdown file of a skill, at install and at
  every load. A skill with findings is not loaded; Settings shows it with the reason in plain
  language and the line. An invalid skill (no `SKILL.md`, bad name or description) is refused
  at install with the reason.
- **On/off:** each added skill has a switch in Settings (saved in `settings.json`, default on)
  and can be removed (only Bochica's copy is deleted). Built-in skills are always on.
- **Slash commands:** typing `/` at the start of the message opens a menu, filtered as the user
  types; arrows move, Enter or Tab picks, Esc closes. App commands run in the app and are not
  sent: `/new`, `/consult`, `/tasks`, `/draw`, `/settings`. Every enabled skill is a command too:
  `/<skill> what to do` is sent as typed, and main gives the model that skill's instructions
  with the request. Main expands skill commands in every message of the history (they're short
  and keep follow-ups on track), and the activity log shows "Used the skill X".
- **`@file` mentions:** typing `@` after a space or at the start opens a menu of files in the
  session's working folder (`files:search`, at most 50, skipping hidden, generated and
  protected folders and secret files). Picking inserts `@path`, quoted when it has spaces.
  Main reads every `@path` of the **new** message with the `read_file` tool (same checks,
  limits and blocks) and appends the contents to what the model gets; the activity log shows
  each read, or why it was blocked. Older messages keep the plain `@path`: the model can read
  the file again. Text that isn't an existing file (`@everyone`) is left alone.
- **Moved out:** skills inside the working folder (`.bochica\skills`), downloading skills from
  a URL or a catalog, and honouring `allowed-tools` → backlog.

## Tasks

### S8-01 · Skill format and tools

Packages: agent.

- [x] `parseSkillFile(text)` → name, description, body, or why it is invalid; `loadSkill(dir, id)`
      reads a folder (references listed, every `.md` scanned); `findSkillDirs(root)` for a folder
      that is one skill or holds several.
- [x] `SkillSet` (find by name, read a reference inside a skill's folder only) and the tools
      `use_skill` and `read_skill_file`; `systemPrompt` lists added skills by name and
      description.
- [x] Tests: valid and invalid front matter (missing, bad name, too long, CRLF, quotes),
      traversal on `read_skill_file`, injected Markdown in a reference file.

### S8-02 · Added skills in main

Packages: shared, desktop (main).

- [x] `SkillService`: built-in skills as in S6 plus `userData\skills\user`; `install(folder)`
      (validate, scan, limits, copy, replace same name), `remove(id)`, `setEnabled(id, on)`;
      the store of S6 becomes its built-in source. Tests on a temporary folder.
- [x] IPC: `skills:list` (`SkillInfo`: id, name, description, source, enabled, status
      `ok` / `skipped` with findings), `skills:install` (folder picker in main; result says
      what was added or why not), `skills:remove`, `skills:set-enabled`.
- [x] `ChatService` gives every mode the enabled skills and the two skill tools.

### S8-03 · Skills in Settings

Packages: desktop (renderer).

- [x] A Skills section: each skill with name, description and a Built in / Added badge; a
      switch and a remove button for added ones; skipped ones with the finding and line in plain
      words. An "Add skill" button opens the folder picker and reports the result.
- [x] Strings in en and es.

### S8-04 · Slash commands

Packages: shared, desktop.

- [x] `parseSlashCommand(text)` in shared; `expandSkillCommands(messages, skills)` in agent;
      table tests (`/name args`, `/name` alone, `/unknown`, a slash mid-text, multi-line).
- [x] Composer menu with app commands and skills (keyboard and mouse); app commands run
      without sending. Pure trigger logic (`lib/composer-trigger.ts`) with tests.
- [x] Main expands skill commands and emits a `use_skill` step in the activity log.

### S8-05 · `@file` mentions

Packages: shared, agent, desktop.

- [x] `parseMentions(text)` in shared (plain and quoted paths, ignores e-mail addresses); tests.
- [x] IPC `files:search({ folder, query })`, validated like a working folder; tests on a
      temporary folder (limits, `.env` and hidden folders left out).
- [x] Composer menu for `@`; main reads mentions through `read_file`, appends them to the new
      message for the model, and logs each read.

## Demo

With the fake model, on the built app with an isolated user-data folder: add a demo skill
folder in Settings (it appears, enabled); add one with "ignore previous instructions" in a
reference file (refused with the reason). In a session, `/` lists the app commands and the
skill; `/tasks` switches mode without sending; `/<skill> …` shows "Used the skill" and the model
gets its instructions. `@` lists files of the working folder; a mentioned file shows as read in
the log and its content reaches the model; `@.env` is blocked. Turning the skill off removes it
from the `/` menu and from the prompt.

## Outcome

Closed 2026-10-27.

- Shipped: `parseSkillFile` / `loadSkill` / `findSkillDirs` / `SkillSet` in `@bochica/agent`
  (agentskills.io header with quoted, folded and continued values; every Markdown file scanned;
  links not followed; 200 files / 5 MB); `use_skill` and a `read_skill_file` that serves any
  skill. `SkillService` in main with the built-in source of S6 and added skills under
  `userData\skills\user`, install from a folder (one skill or several, copied through a
  temporary folder, same name replaces), remove, on/off in `settings.json`. Skills section in
  Settings with badges, switches, remove, "Add skill…" and the injection findings in plain
  words. Composer menus for `/` (app commands `/new`, `/consult`, `/tasks`, `/draw`,
  `/settings`, then skills) and `@` (files of the working folder); `parseSlashCommand`,
  `parseMentions`, `expandSkillCommands`, `attachMentions`, `findFiles`, `runTool` (the body of
  `toToolSet`, now shared with mentions). 470 tests.
- Decisions taken while building: app command names are reserved, so no skill can shadow
  `/tasks`; a skill that wasn't loaded shows its switch off and disabled; mentions in Draw do
  nothing, since Draw has no file tools; `/eplan-scripting` works in every mode (in Consult its
  guide is in the prompt anyway).
- Demo on the built app with the fake model (isolated `--user-data-dir`, Spanish UI): Settings
  listed the two built-in skills, `plc-labels` (on) and `evil-helper` "Not loaded" because a
  reference file "asks the assistant to ignore its instructions" and "asks to read passwords,
  keys or .env files" (`notes.md`, line 2). `/` listed the five app commands and the three
  skills; `/ta` + Enter switched to Tasks without sending. `/plc` + Tab completed the skill,
  `@mot` offered `motores.txt` (`.env` never offered), Enter inserted it. Sent with `@.env`: the
  log said "Used a skill, read a file, blocked an action", and the model got the skill's
  instructions, the request, `motores.txt` with numbered lines and a note that `.env` was
  blocked, never its content. "usa la skill…" made the model call `use_skill`, which returned
  the instructions and the reference list. In Consult the guides were inline and only
  `plc-labels` was listed; after switching it off it left the `/` menu and the prompt, and
  `/plc-labels …` went to the model as plain text.
- Found and fixed during the demo: the switch of a skill that wasn't loaded looked on.
- Not exercised: the system folder picker of "Add skill…" (the demo placed the skills in the
  user-data folder; installing is covered by tests on a temporary folder), and a real model.
