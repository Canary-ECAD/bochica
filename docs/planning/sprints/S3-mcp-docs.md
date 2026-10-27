# S3 — EPLAN docs over MCP

**Status:** done
**Goal:** the agent answers EPLAN questions using the P8 2027 documentation RAG, and the user
can see every tool call it makes, Claude Code-style. Ends milestone M0.

Design references: [guardrails.md](../../design/guardrails.md) (layer 5, the approval card) and
the "Visible activity log" item in [BACKLOG.md](../BACKLOG.md).

## Tasks

### S3-00 · Publish and CI (carried over from S2-00)

Packages: root.

- [x] Public repository `Canary-ECAD/bochica` created and `main` pushed.
- [x] `.github/workflows/check.yml` has run green on GitHub (S1 and S2 pushes, ~1–1.5 min on
      `windows-latest`).

### S3-01 · MCP client manager

Packages: agent, desktop (main).

- [x] Main connects to the MCP servers in `@bochica/eplan`'s `defaultMcpServers` that are
      enabled: HTTP ones with `@modelcontextprotocol/sdk`'s streamable HTTP transport (stdio
      comes in S4). The 2027 docs server is always on; 2026 and EEC Pro are off by default.
- [x] Each server reports `connecting` / `ready` (with its tool count) / `error`; a failing
      server never blocks chat, it just contributes no tools.
- [x] Tools are listed once per connection and cached; reconnect with backoff.

### S3-02 · Tools in the agent loop

Packages: agent.

- [x] `runTurn` accepts a tool set and runs multiple steps (tool call → result → continue) up to
      a step limit; new events `tool-call` (id, server, tool, input) and `tool-result` (id,
      output summary, ok/error).
- [x] Tool results pass through `redactSecrets` before reaching the model or the UI, and are
      truncated to a size limit with a note.
- [x] Tests with the mock model cover a tool round-trip, a failing tool and the step limit.

### S3-03 · Activity log in the chat

Packages: desktop (renderer), shared.

- [x] Consecutive tool calls between assistant texts collapse into one summary line in plain
      language ("Searched the EPLAN 2027 docs 3 times"), expandable to one row per call with a
      short description, expandable again to input and output.
- [x] A running call shows a spinner; a failed one shows an error icon with the reason.
- [x] Strings in en and es.

### S3-04 · Approval card framework

Packages: agent, shared, desktop.

- [x] A tool can be marked `needsApproval`; the loop pauses, main sends an approval request,
      the renderer shows a card (plain-language summary, "Details" with the raw input,
      **Allow once** / **Allow for this session** / **Deny**), and the answer resumes or
      denies the call. 5-minute timeout → denied.
- [x] The docs RAG tools are read-only and never ask; a test-only tool exercises the card.

### S3-05 · Documentation sources in Settings

Packages: desktop.

- [x] Settings → "EPLAN documentation" lists the three RAGs with their status; 2027 is always on
      (switch disabled, with an explanation), 2026 and EEC Pro can be toggled. The choice
      persists in main.

## Demo

Ask "How do I create a macro in EPLAN 2027?". The activity log shows the documentation searches;
the answer cites what it found. Turn on EEC Pro in Settings and ask an EEC Pro question: its
tools are used. Disconnect the network: chat still works without tools and the docs status
shows the error.

## Outcome

Closed 2026-10-27. Milestone M0 is functionally complete; it still needs a run with a real cloud
model (see below).

- Shipped: `McpManager` (streamable HTTP, per-server state, backoff 2/5/15/30 s, generation
  counter so stale connects are dropped); tools in `runTurn` via AI SDK `dynamicTool` with
  `stopWhen: stepCountIs(12)`, approval before execution, redaction, truncation (20k chars to
  the model, 2k in the UI); `ApprovalService` in main (once / session / deny, 5-min timeout,
  Stop denies pending cards); `SettingsStore` for the docs toggles; activity log grouping
  consecutive calls with plain-language labels; approval card; "EPLAN documentation" section in
  Settings with live status. 110 tests.
- Demo on the built app with a **fake OpenAI-compatible model** that issues real tool calls,
  against the **real** docs servers: 2027 showed "Ready · 3 tools"; switching EEC Pro on
  connected it live ("Ready · 2 tools"); asking about macros produced a real
  `eplan2027_search` call ("Searched the EPLAN 2027 docs for Macro") whose result reached the
  model. With `BOCHICA_DEV_TOOLS=1` the approval card appeared; Deny kept the tool from running
  and told the model; "Allow for this session" ran it, and the next call in that session ran
  without asking.
- Not exercised: a real cloud model choosing tools on its own (answer quality and citations
  depend on it), the network-down case, and the 5-minute timeout in the UI (covered by a unit
  test with a short timeout).
- Tool results are not replayed in later turns: history keeps only text. Fine for docs
  questions; revisit when EPLAN actions arrive in S4.
