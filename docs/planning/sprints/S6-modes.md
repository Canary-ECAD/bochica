# S6 — Modes and typed confirmation

**Status:** done
**Goal:** the user chooses what the agent may do — just answer and help with scripts, work in
EPLAN, or draw — and destructive EPLAN actions need the user to type an explicit confirmation.

## Decisions

- **Three modes**, picked in the composer and sent with every turn:
  - **Consult** (es: Consulta): EPLAN questions with the documentation RAGs, and help writing
    EPLAN scripts with eplan-scripting-skill. No EPLAN tools at all.
  - **Tasks** (es: Tareas): the documentation plus eplan-mcp, except the drawing tools.
  - **Draw** (es: Draw): the experimental drawing tools (`eplan_live_*` pages, symbols,
    connections) plus what they need to read the project; marked "Experimental".
    The mode filters the tools main hands to the model, and adds a mode section to the system
    prompt. Default: Consult. The last mode used is remembered.
- **Scripting skill**: Bochica downloads eplan-scripting-skill at the commit pinned in
  `components.lock.json` and caches it under `userData\skills\<commit>`; in Consult mode the
  P8 and EEC Pro `SKILL.md` go into the system prompt and a read-only tool reads their reference
  files on demand. `BOCHICA_SKILLS_DIR` points at a local checkout instead (development). The
  general skills system is still S8.
- **Typed confirmation** (guardrails layer 6) for: `eplan_project_management` with
  `REORGANIZE` (irreversible purge), deleting a scratch project, deleting device lists or
  representation types, removing a project language, restoring a project or master data
  (can overwrite), and raw actions or scripts whose input mentions deleting, removing or
  purging. The card shows a text box; the user must type the project name, or the word
  DELETE / ELIMINAR when there is no name. Main checks the text, never only the button. Always
  asks; never allowed for the session.
- **Scratch projects** (answer to the "shadow copy" question): eplan-mcp's scratch tools clone a
  template into `%TEMP%\eplan_mcp_scratch` (AppData), but only when those tools are used; the
  other tools act on the real project. Bochica's own backup before the first change stays.

## Tasks

### S6-01 · Typed confirmation

Packages: eplan, agent, shared, desktop.

- [x] `eplanConfirmation(tool, input)` decides when a call needs typed confirmation and what to
      type; table tests for every case above and for look-alikes that must not trigger.
- [x] `AgentTool.confirmation` → the approver gets it; `ApprovalRequest.confirm` and
      `ApprovalResponse.typed`; `ApprovalService` denies when the text doesn't match.
- [x] The card: warning style, what will be destroyed, a text box, and the confirm button
      enabled only when the text matches; Enter submits.

### S6-02 · Tools per mode

Packages: shared, eplan, desktop (main).

- [x] `ChatMode` (`consult` | `tasks` | `draw`) in `ChatSendRequest`; `@bochica/eplan` says which
      eplan-mcp tools each mode gets; tests that Consult has no EPLAN tool, Tasks has no drawing
      write tool, Draw has the drawing tools and none of the project-wide writers.
- [x] `ChatService` filters tools by mode.

### S6-03 · Mode prompts and the scripting skill

Packages: agent, desktop (main).

- [x] `systemPrompt(mode, skill?)`: common rules plus a section per mode.
- [x] `SkillStore`: download at the pinned commit with a cache, or read `BOCHICA_SKILLS_DIR`;
      read-only tool `bochica__read_skill_file` (paths limited to the skill folder). Tests with
      a fake fetch, including path traversal attempts.

### S6-04 · Mode picker

Packages: desktop (renderer).

- [x] A three-way picker in the composer with an icon, name and one-line description each;
      Draw shows "Experimental". The choice is remembered; the session page sends it.
- [x] Strings in en and es.

## Demo

In Consult, ask how to write a script that lists pages: no EPLAN tool is offered, the answer
follows the skill. Switch to Tasks: EPLAN tools appear (activity log), drawing tools don't. In
Draw the drawing tools are offered. With the fake model, ask for a REORGANIZE: the card asks
for the project name; a wrong name keeps the button disabled; Deny works.

## Outcome

Closed 2026-10-27.

- Shipped: `Confirmation` + `confirmationMatches` in `@bochica/shared`; `eplanConfirmation` for
  REORGANIZE, scratch-project discard, device-list / representation-type deletes, language
  removal, restores, and raw actions or scripts whose input mentions delete/remove/purge…
  (matched anywhere, so camel-case action names count); `AgentTool.confirmation` forces an
  `always` approval with what to type; `ApprovalService` denies unless the typed text matches;
  destructive card (red, text box, button locked until it matches, no "this session").
  `ChatMode` (consult / tasks / draw), `eplanToolInMode`, mode prompts, `SkillStore` (download at
  the pinned commit, cache, local override, traversal-safe read tool), mode picker. 207 tests.
- Demo on the built app with the fake model and a real EPLAN 2026: Consult offered 6 tools
  (docs + scripting guide, no EPLAN) and its prompt carried the guide; Tasks 205 EPLAN tools
  without placement; Draw 33 with placement and without `project_management`. The skill
  downloaded from GitHub on first start (2 skills). A REORGANIZE showed the destructive card
  asking for "Demo": empty and "demo" kept the button locked, "Demo" unlocked it; it was
  denied, and the model was told. The project in the demo doesn't exist on the machine.
- Found and fixed during the demo: the card described REORGANIZE as "EPLAN: project
  management"; it now says what will be lost.
- Not exercised: a real model choosing tools per mode; a confirmed destructive action (on
  purpose).
