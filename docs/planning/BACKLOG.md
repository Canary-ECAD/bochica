# Backlog

Requests and ideas not yet scheduled. Newest at the bottom. When one is pulled into a sprint,
move it there and leave a link here (`→ S4-03`).

## UI

- Everything a user can do in Claude Code Desktop that makes sense for EPLAN work — to be
  itemized as requests come in.
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
  summary is written in the UI language. → S3 (tool rows), S7 (file diffs)
- **Context usage panel** (like Claude Code's "Context" popover). A bar and a table showing
  how much of the model's context window is used, split by category: messages, system prompt,
  built-in tools, MCP tools, skills, MCP server instructions, compaction buffer, free space;
  plus deferred tools and an expandable MCP tool list. Provider-agnostic approach: the total
  comes from the provider's reported input tokens of the last turn (the AI SDK normalizes
  usage for every provider); the per-category split is estimated by counting each part with a
  local tokenizer and scaling it to that total; the window size comes from a model catalog.
  Exact per-category counts are shown only where a provider offers a token-counting API.
  → S9 (with compaction)

## Agent

- Hermes-style guardrails: see [guardrails.md](../design/guardrails.md) (core → S7, advanced → S10).
- **Typed confirmation for destructive actions.** Deleting EPLAN projects (one or many) and
  other bulk-destructive actions must not be one click away: the user has to type an explicit
  phrase in a text box (e.g. the project name or "DELETE") before the action can run, every
  time, never allowed for the session. Destructive work stays possible, just never easy.
  → done in S6
- **Answered:** eplan-mcp's scratch tools work on clones in `%TEMP%eplan_mcp_scratch` (AppData), but only
  when those tools are used; other tools change the real project, so Bochica's backup stays
  (see S6-modes.md).

## Infrastructure

- GitHub Actions CI running `bun run check` on `windows-latest` for every push and PR → done in S3-00.
