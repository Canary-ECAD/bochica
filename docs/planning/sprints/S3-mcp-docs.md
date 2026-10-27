# S3 — EPLAN docs over MCP

**Status:** active
**Goal:** the agent answers EPLAN questions using the P8 2027 documentation RAG, and the user
can see every tool call it makes, Claude Code-style. Ends milestone M0.

Design references: [guardrails.md](../../design/guardrails.md) (layer 5, the approval card) and
the "Visible activity log" item in [BACKLOG.md](../BACKLOG.md).

## Tasks

### S3-00 · Publish and CI (carried over from S2-00)

Packages: root.

- [ ] Public repository `Canary-ECAD/bochica` created and `main` pushed (needs the maintainer's
      permission).
- [ ] `.github/workflows/check.yml` has run green on GitHub.

### S3-01 · MCP client manager

Packages: agent, desktop (main).

- [ ] Main connects to the MCP servers in `@bochica/eplan`'s `defaultMcpServers` that are
      enabled: HTTP ones with `@modelcontextprotocol/sdk`'s streamable HTTP transport (stdio
      comes in S4). The 2027 docs server is always on; 2026 and EEC Pro are off by default.
- [ ] Each server reports `connecting` / `ready` (with its tool count) / `error`; a failing
      server never blocks chat, it just contributes no tools.
- [ ] Tools are listed once per connection and cached; reconnect with backoff.

### S3-02 · Tools in the agent loop

Packages: agent.

- [ ] `runTurn` accepts a tool set and runs multiple steps (tool call → result → continue) up to
      a step limit; new events `tool-call` (id, server, tool, input) and `tool-result` (id,
      output summary, ok/error).
- [ ] Tool results pass through `redactSecrets` before reaching the model or the UI, and are
      truncated to a size limit with a note.
- [ ] Tests with the mock model cover a tool round-trip, a failing tool and the step limit.

### S3-03 · Activity log in the chat

Packages: desktop (renderer), shared.

- [ ] Consecutive tool calls between assistant texts collapse into one summary line in plain
      language ("Searched the EPLAN 2027 docs 3 times"), expandable to one row per call with a
      short description, expandable again to input and output.
- [ ] A running call shows a spinner; a failed one shows an error icon with the reason.
- [ ] Strings in en and es.

### S3-04 · Approval card framework

Packages: agent, shared, desktop.

- [ ] A tool can be marked `needsApproval`; the loop pauses, main sends an approval request,
      the renderer shows a card (plain-language summary, "Details" with the raw input,
      **Allow once** / **Allow for this session** / **Deny**), and the answer resumes or
      denies the call. 5-minute timeout → denied.
- [ ] The docs RAG tools are read-only and never ask; a test-only tool exercises the card.

### S3-05 · Documentation sources in Settings

Packages: desktop.

- [ ] Settings → "EPLAN documentation" lists the three RAGs with their status; 2027 is always on
      (switch disabled, with an explanation), 2026 and EEC Pro can be toggled. The choice
      persists in main.

## Demo

Ask "How do I create a macro in EPLAN 2027?". The activity log shows the documentation searches;
the answer cites what it found. Turn on EEC Pro in Settings and ask an EEC Pro question: its
tools are used. Disconnect the network: chat still works without tools and the docs status
shows the error.

## Outcome

_(fill in when the sprint closes)_
