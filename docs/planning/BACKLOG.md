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

## Infrastructure

- GitHub Actions CI running `bun run check` on `windows-latest` for every push and PR → done in S3-00.
- **Built-in skills inside the installer** → done in S11. Today the built-in skills (eplan-scripting-skill, eec-pro-skill) are downloaded
  from GitHub on the first start; offline or behind a proxy that blocks GitHub, the app starts
  without its skills and only the log says why. The installer should carry the pinned commit
  (like Python and `uv`), the download stays only for updates, and a missing skill shows a
  plain message in the app.
