# Roadmap

**Active sprint: S13 — OAuth and several keys per provider (to be planned)**

Each milestone ends with something a non-technical user could try.

## M0 — Ask EPLAN questions

A user installs the dev build, pastes an API key and gets answers grounded in the EPLAN 2027
documentation.

| Sprint                          | Goal                                                                                                                | Status |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| [S1](sprints/S1-foundations.md) | Quality gate, error handling, API keys stored safely and testable from Settings                                     | Done   |
| [S2](sprints/S2-chat.md)        | Streaming chat with any configured provider; Claude Code-style message view                                         | Done   |
| [S3](sprints/S3-mcp-docs.md)    | MCP client; P8 2027 docs RAG always on, 2026/EEC Pro toggles; tool calls shown in the chat; approval card framework | Done   |

## M1 — Act on EPLAN

The agent drives a running EPLAN safely, and conversations survive a restart.

| Sprint                            | Goal                                                                                                                                                                                                                                              | Status |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [S4](sprints/S4-eplan-actions.md) | Local EPLAN MCP over stdio (dev Python); connection status; Remote Client check with guided fix; EPLAN write tools behind approval; project backup before the first change                                                                        | Done   |
| [S5](sprints/S5-sessions.md)      | SQLite + Drizzle: sessions and messages persisted; Recent list; resume, rename, delete                                                                                                                                                            | Done   |
| [S6](sprints/S6-modes.md)         | Modes: **Consulta** (docs RAG + script assistance with eplan-scripting-skill, no EPLAN actions), **Tareas** (EPLAN actions over MCP), **Draw** (experimental drawing tools); typed confirmation for destructive actions such as deleting projects | Done   |
| [S7](sprints/S7-builtin-tools.md) | Built-in tools (files, search, PowerShell) in a per-session working folder, shipped together with the guardrails core from [guardrails.md](../design/guardrails.md)                                                                               | Done   |

## M2 — Claude Code parity

| Sprint                                             | Goal                                                                                                                       | Status |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| [S8](sprints/S8-skills-commands.md)                | Skills beyond the default one, slash commands, `@file` mentions                                                            | Done   |
| [S9](sprints/S9-context-subagents-todos.md)        | Context compaction, subagents, todo list in the UI                                                                         | Done   |
| [S10](sprints/S10-checkpoints-plan-permissions.md) | Checkpoints and rewind; plan mode; guardrails advanced (deny rules, always allow, YOLO, smart approvals, approval history) | Done   |

## M3 — Ship it

| Sprint                                    | Goal                                                                                        | Status  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | ------- |
| [S11](sprints/S11-installer-first-run.md) | Installer with bundled Python + `uv`; first-run wizard (EPLAN detected? key? test question) | Done    |
| [S12](sprints/S12-updater-release.md)     | One-click updater; release process; components.lock bump procedure                          | Done    |
| S13                                       | OAuth (device code, PKCE) for providers that allow it; multiple keys per provider           | Outline |
| [S14](sprints/S14-eplan-mcp-contract.md)  | eplan-mcp contract: tool annotations upstream, tagged releases, policy from facts, watch    | Planned |

## M4 — EPLAN workflows

Bochica does whole EPLAN jobs, not only single actions. Each sprint starts by pinning down the
scope (the issues are short), then adds what is missing to eplan-mcp, a built-in skill that
knows the workflow, and the app pieces it needs. Details in [BACKLOG.md](BACKLOG.md#eplan-workflows).

| Sprint | Goal                                                                                                              | Status  |
| ------ | ----------------------------------------------------------------------------------------------------------------- | ------- |
| S15    | Parts database doctor (Canary-ECAD/bochica#1): health report of the parts database, fixes in approved batches     | Outline |
| S16    | PLC generator (Canary-ECAD/bochica#2): PLC cards and control schematics from part numbers and an I/O list         | Outline |
| S17    | Eyes and PDF to schematic (Canary-ECAD/bochica#3): images and PDFs for the model, redraw a PDF schematic in EPLAN | Outline |

Requests from [BACKLOG.md](BACKLOG.md) are slotted into these sprints when each one is planned.
