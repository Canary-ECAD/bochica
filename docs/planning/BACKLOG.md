# Backlog

Requests and ideas not yet scheduled. Newest at the bottom. When one is pulled into a sprint,
move it there and leave a link here (`→ S4-03`).

## UI

- Everything a user can do in Claude Code Desktop that makes sense for EPLAN work — to be
  itemized as requests come in.
- **Inline code shows its backticks** in answers (`` `.ema` `` appears with the backticks): the
  typography plugin adds them around `code`; `markdown.tsx` should switch that off. Seen in the
  S11 demo.
- **New-session heading**: no "What do you want to do in EPLAN today?"; a large greeting that
  changes daily ("Good morning", "Happy Tuesday", "New task"). → done in S5
- **Modes** in the composer. **Consulta**: questions about EPLAN (docs RAGs) and help writing
  EPLAN scripts (eplan-scripting-skill), no actions on EPLAN. **Tareas**: acting on EPLAN through
  eplan-mcp. **Draw**: the experimental drawing tools (`eplan_live_*` page/symbol/connection
  tools), clearly marked experimental. → done in S6
- **Visible activity log** (like Claude Code Desktop). Between assistant messages, consecutive
  tool calls collapse into one summary line in plain language ("Ran 3 commands", "Created 6
  files, edited 2 files, read 1 file"), with a total diff badge (`+340 −2`). Expanding it lists
  each call with a short description, the file name and its own diff badge; each row expands
  again to show input/output or the diff, and long descriptions show a tooltip on hover. The
  summary is written in the UI language. → S3 (tool rows), done in S7 (file diffs)
- **Context usage panel** (like Claude Code's "Context" popover). A bar and a table showing
  how much of the model's context window is used, split by category: messages, system prompt,
  built-in tools, MCP tools, skills, MCP server instructions, compaction buffer, free space;
  plus deferred tools and an expandable MCP tool list. Provider-agnostic approach: the total
  comes from the provider's reported input tokens of the last turn (the AI SDK normalizes
  usage for every provider); the per-category split is estimated by counting each part with a
  local tokenizer and scaling it to that total; the window size comes from a model catalog.
  Exact per-category counts are shown only where a provider offers a token-counting API.
  → S9 (a ring with used / window and three estimated parts); the full popover is still open

## Agent

- Hermes-style guardrails: see [guardrails.md](../design/guardrails.md) (core → done in S7, advanced → done in S10).
- **Typed confirmation for destructive actions.** Deleting EPLAN projects (one or many) and
  other bulk-destructive actions must not be one click away: the user has to type an explicit
  phrase in a text box (e.g. the project name or "DELETE") before the action can run, every
  time, never allowed for the session. Destructive work stays possible, just never easy.
  → done in S6
- **Answered:** eplan-mcp's scratch tools work on clones in `%TEMP%eplan_mcp_scratch` (AppData), but only
  when those tools are used; other tools change the real project, so Bochica's backup stays
  (see S6-modes.md).
- **Skills, more sources** (left out of S8): skills inside the working folder
  (`.bochica\skills`), installing a skill from a URL or a catalog, and honouring the
  `allowed-tools` field of a skill's header.
- **`@` for folders** (left out of S8): mentioning a folder could attach its file list.
- **Learned skills, with approval** (like Hermes Agent's `skill_manage`; check its current
  code first). The agent proposes a new skill, or a fix to one it learned, after a multi-step
  workflow worth repeating, after finding the way out of an error, or when the user corrected
  its approach ("lessons, not logs"). Unlike Hermes, approval is on by default: a card shows
  the proposed skill or the change in plain language, with Save / Discard, and the injection
  scan runs before saving. Saved under `userData\skills\learned`, labelled "Learned" in
  Settings, where it can be read, edited, deleted, and its last change undone. A skill never
  grants tools the mode doesn't have. Later, optional: short durable memory facts and a
  background review after turns (costs tokens, so not on by default). Own sprint, or with S10
  (approvals).

- **Left out of S10:** a `/rewind` command; checkpoints for files changed by PowerShell commands
  (today only the file tools are tracked, and the rewind dialog says so); "Always allow" by
  category, e.g. every file write inside the working folder.

- **Left out of S9:** the full "Context" popover (every MCP tool, deferred tools, compaction
  buffer), exact token counting where a provider has an API for it, and a helper's own tool
  calls shown nested in the activity log.

- **Left out of S13:** the device-code sign-in (build it when a provider offers one without a
  secret or another tool's client id); rotation strategies other than "in order" (round
  robin, least used); a note in the chat when a call moved to another key.

- **Left out of S13b (Claude Agent):** reuse a Claude Code session between turns instead of a
  transcript; images; the run's thinking in the activity log; context usage from the last call
  of a run instead of the sum.

## EPLAN workflows

From the enhancement issues. Each one is an outline sprint in ROADMAP.md (M4); the open
questions are answered when the sprint is planned.

- **Parts database doctor** (Canary-ECAD/bochica#1) → planned as
  [S15](sprints/S15-parts-doctor.md), rules first. Left out of it, to add a piece at a time:
  - Function templates and pictures for parts the database already has: the portal skips their
    part data on download, so they need a way to update an existing part (S15 only brings the
    macro file and sets 22145). The download stages the part's `.part.xml` in
    `%TEMP%\EDPADL\<id>\$(MD_XML)`; importing that in update mode may be the way.
  - Clearing the download list after a download: the add-in's own "Delete parts after import /
    download" switch (the skill suggests it), or in the next doctor run `DELETE /basketitems`
    for parts already in the database, which needs a Data Portal PAT stored like an API key.
  - Part numbers the portal stores differently (Rittal's `3239.200` as `RIT.3239200`, Lapp):
    try the order and type numbers, and the manufacturer's spelling, before saying "not found".
  - Parts a project uses that the database lacks (`eplan_export_parts_list`,
    `P_ARTICLEREF_PARTNO`; slow on large projects).
  - The portal's lifecycle: parts no longer `Active`.
  - Picture and macro files a part names that don't exist once their `$(…)` variable is
    resolved.
  - Rules the user writes (property, condition, severity), per product group or manufacturer.
  - A view of its own for the report; a scheduled report; DXF and E3D downloads.
- **Macros by product number** (Canary-ECAD/bochica#2) → S16. A variable product number
  (`MS-400-7K5-B`) picks the macros, variants and value sets of its product. The input is a
  macro project whose macros are drawn but carry no rules saying which product takes which.
  Planned with the maintainer: the rules are a file the user owns, a linter checks the macro
  project against them, fixes come in approved batches, and a deterministic generator builds a
  product number's pages. Sheet sizes and plot frames stay the user's. Later:
  - EEC Pro as another generator.
  - Rules imported from a spreadsheet the user already keeps.
- **The project as code** (Canary-ECAD/bochica#4), after S16. Like Terraformer and Terraform:
  read an existing project into a text file (structure, devices with part numbers, PLC I/O,
  logical connections), lint it, show a plan (the difference with the project) and apply it.
  - Read it live through eplan-mcp, or without EPLAN from an `.epdz`: Canary-ECAD/ecad-view's
    `e3d-core` (TypeScript, no UI) already reads its `manifest.db` and AutomationML (designations,
    part numbers, eCl@ss, positions, bridges). It would come as a pinned dependency.
  - What doesn't fit: EPLAN is neither declarative nor idempotent, and page layout isn't declared.
    A first apply would only add and update, never delete.
  - S16's rules file and linter are its first piece.
- **Eyes and PDF to schematic** (Canary-ECAD/bochica#3) → S17. Redraw a PDF schematic in EPLAN
  with any model; EPDZ projects as guidance.
  - What exists: the live drawing primitives (Canary-ECAD/eplan-mcp#34: create pages, place
    symbols, connect pins, read back) and page exports to PDF and graphics files.
  - Missing in Bochica: the model can't see images. Needed: attaching images and PDFs in the
    composer (per provider: not every model takes them), and tools that return an image, such
    as a rendered EPLAN page, so the agent can compare what it drew with the source.
  - Vision alone guesses positions. Bochica gives the model **exact positions** from the page
    itself, as a tool that returns text with coordinates:
    - a PDF exported from a CAD tool is vector: its texts (device tags such as `-K1`, pin
      numbers), lines and boxes come out with exact coordinates, no OCR needed;
    - a scanned PDF or a photo needs OCR. Windows has an offline OCR engine that returns each
      word with its box, so nothing has to be bundled for it;
    - symbol shapes (a relay coil, a contact) are found by the vision model, anchored to those
      texts and lines, and can be compared against the EPLAN symbol library.
  - Sketch: extract the page (texts, lines, symbols with positions), map it to EPLAN symbols,
    draw with the primitives, render the page, compare with the source, correct. Made-up sample
    projects (EPDZ) exported to PDF give pairs with a known answer, to measure how close a redraw
    gets (devices and connections found by `eplan_live_read_page`). Only made-up projects: this
    is a public repository.
  - Open: what does an EPDZ give as "eyes" — the reference structure to learn from, or test
    cases? Scope of the first version (one page, one symbol library)?

## Infrastructure

- **Code signing** (left out of S12): the installer isn't signed, so Windows SmartScreen warns on
  the first install and the updater checks only the SHA-512 in `latest.yml`. With a certificate,
  set `publisherName` so updates must come from the same publisher.
- **eplan-mcp on a non-English Windows** (seen in the S12 demo): its port discovery parsed
  `tasklist` / `netstat` text, which is in the console's language and code page, so on a Spanish
  Windows it failed with `UnicodeDecodeError` and fell back to port 49152. → fixed in
  Canary-ECAD/eplan-mcp#74 (Windows API instead of console text), pinned in S12.
- **Contract with eplan-mcp instead of guessing.** eplan-mcp publishes no safety annotations, so
  `tool-policy.ts` classifies ~200 tools by name and every bump is a manual review. Keep the
  repositories separate, but have eplan-mcp declare MCP annotations and EPLAN facts, publish
  tagged releases with a tool list, and let Bochica derive its policy and watch for releases.
  → S14
- **eplan-mcp names the wrong version** (seen in S15): with only P8 2025 running,
  `eplan_connect` answers `target_version: "2026"` (the newest installed Remote Client, not the
  running EPLAN). It works, but a version-dependent tool or message could go wrong. Since
  eplan-mcp#80 it matters more: the 2027 tools are gated on that version, so with 2027
  installed and an older EPLAN running they may run and fail.
- **The eplan-mcp bump past eplan-mcp#82** → done: v1.3.0 pinned, Draw lists and policies as planned here (24 live tools and a pinned target project,
  merged after v1.2.0). Already in Bochica: the backup guard follows the pinned target
  (`eplan_live_set_target_project`, forgotten when the server restarts), and `eplan_live_batch`
  needs typed confirmation when an operation removes something. At the bump:
  - Draw gets the placement tools (`eplan_live_place_device`, `_place_terminal`,
    `_insert_macro`, `_place_panel_item`, `_place_plc_point`, `_place_cable_definition`,
    `_update_placement`, `_batch`) in `placementTools`, and `_find_placements`,
    `_render_page`, `_check_page` and `_set_target_project` in `drawingReads`; everything
    else (cables, terminal strips, reports, project creation, copying pages) stays in Tasks.
  - Review `eplan-tool-policies.json`: `eplan_live_set_target_project` comes as idempotent,
    so it asks; `_batch` and `_copy_pages_to_structure` are destructive, so they always ask.
  - `allow_real_project` (eplan-mcp's scratch guard, already on the drawing tools in v1.2.0) is
    not a typed confirmation in Bochica: Draw works on the user's project by design, and the
    card plus the project backup cover it.
- **The eplan-mcp bump past eplan-mcp#84** (the C# script host) → done 2026-11-12, pinned by
  commit: `main` had no release tag yet. Its server folder is now `python/` (was
  `eplan-p8-mcp-server/`), so the runtime layout went to 3. 28 tools came, none left or changed;
  the six that act outside project data (UI driving, add-in deploy, scratch symbols) stay off,
  since Bochica never sets `EPLAN_MCP_ENABLE_TOOLS`. Still to do:
  - Once eplan-mcp tags a release holding this commit, `components:bump eplan-mcp vX.Y.Z` so
    the lock records the tag again (the watch already skips releases the pin holds).
  - **The script host in Bochica.** `notOffered` (`modes.ts`) hides the seven `eplan_script_*`
    tools. To offer them: ship the host inside the runtime at a pinned `host-v` release (never
    eplan-mcp's own download into `~\.eplan-mcp\host`), make the parts guard read
    `eplan_script_run`'s source and library scripts, decide whether Bochica ever sets
    `EPLAN_MCP_ALLOW_REAL_PROJECT_WRITES`, and tell users it needs EPLAN 2027 and the EPLAN API
    developer license. The `host-v` release itself isn't published yet.
  - Convention profiles (`eplan_profile_*`) are kept under `%LOCALAPPDATA%` by eplan-mcp. They
    are a client's standards: say so in the guardrails doc and consider a Settings entry to see
    and delete them.

- GitHub Actions CI running `bun run check` on `windows-latest` for every push and PR → done in S3-00.
- **Built-in skills inside the installer** → done in S11. Today the built-in skills (eplan-scripting-skill, eec-pro-skill) are downloaded
  from GitHub on the first start; offline or behind a proxy that blocks GitHub, the app starts
  without its skills and only the log says why. The installer should carry the pinned commit
  (like Python and `uv`), the download stays only for updates, and a missing skill shows a
  plain message in the app.
