# Roadmap

**Active sprint: [S2 — Streaming chat](sprints/S2-chat.md)**

Each milestone ends with something a non-technical user could try.

## M0 — Ask EPLAN questions

A user installs the dev build, pastes an API key and gets answers grounded in the EPLAN 2027
documentation.

| Sprint                          | Goal                                                                                                                | Status  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- |
| [S1](sprints/S1-foundations.md) | Quality gate, error handling, API keys stored safely and testable from Settings                                     | Done    |
| [S2](sprints/S2-chat.md)        | Streaming chat with any configured provider; Claude Code-style message view                                         | Active  |
| S3                              | MCP client; P8 2027 docs RAG always on, 2026/EEC Pro toggles; tool calls shown in the chat; approval card framework | Outline |

## M1 — Act on EPLAN

The agent drives a running EPLAN safely, and conversations survive a restart.

| Sprint | Goal                                                                                                                                                                       | Status  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| S4     | Local EPLAN MCP over stdio (dev Python); connection status; Remote Client check with guided fix; EPLAN write tools behind approval; project backup before the first change | Outline |
| S5     | SQLite + Drizzle: sessions and messages persisted; Recent list; resume, rename, delete                                                                                     | Outline |
| S6     | Built-in tools (files, search, PowerShell) shipped together with the guardrails core from [guardrails.md](../design/guardrails.md)                                         | Outline |

## M2 — Claude Code parity

| Sprint | Goal                                                                                       | Status  |
| ------ | ------------------------------------------------------------------------------------------ | ------- |
| S7     | Skills (eplan-scripting-skill by default), slash commands, `@file` mentions                | Outline |
| S8     | Context compaction, subagents, todo list in the UI                                         | Outline |
| S9     | Checkpoints and rewind; plan mode; guardrails advanced (smart approvals, approval history) | Outline |

## M3 — Ship it

| Sprint | Goal                                                                                        | Status  |
| ------ | ------------------------------------------------------------------------------------------- | ------- |
| S10    | Installer with bundled Python + `uv`; first-run wizard (EPLAN detected? key? test question) | Outline |
| S11    | One-click updater; release process; components.lock bump procedure                          | Outline |
| S12    | OAuth (device code, PKCE) for providers that allow it; multiple keys per provider           | Outline |

Requests from [BACKLOG.md](BACKLOG.md) are slotted into these sprints when each one is planned.
