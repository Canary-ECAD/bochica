# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Status: scaffold.** The app shell runs (sidebar, empty session, settings with language), with
> one IPC channel wired end to end. Not built yet: the agent loop, MCP connections, credentials,
> SQLite, the Python runtime and the updater. Sections below describe the target design.

> **This is a public repository.** Never add local paths, machine names, customer data, real
> EPLAN projects or information about any company using the tool — not in code, tests,
> fixtures or commit messages. Use made-up sample data.

## What Bochica is

**Bochica by Canary-ECAD** is an open source (MIT) Windows desktop app that lets
**non-technical** people work with EPLAN through an AI agent, with a clean UI in the style of
Claude Code Desktop. The user installs it, pastes an API key and types in plain language; the
app handles everything else.

It offers the capabilities of a coding agent (those of Claude Code and Hermes Agent: chat with
sessions, file and terminal tools, skills, subagents, per-action permissions, MCP) **with any
model provider**, plus a preconfigured EPLAN integration:

| Component                                                             | Repository                                                                                | How it is integrated                                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Local MCP server that drives EPLAN (Python, 199 tools in `full` mode) | [Canary-ECAD/eplan-mcp](https://github.com/Canary-ECAD/eplan-mcp)                         | stdio MCP server launched by Bochica (`eplan-p8-mcp-server/mcp_server/server.py`) |
| EPLAN scripting skills (router + P8 / EEC Pro)                        | [Canary-ECAD/eplan-scripting-skill](https://github.com/Canary-ECAD/eplan-scripting-skill) | Loaded by default (agentskills.io format, `SKILL.md`)                             |
| P8 2027 documentation RAG (required minimum)                          | [Canary-ECAD/eplan-cloudflare-rags](https://github.com/Canary-ECAD/eplan-cloudflare-rags) | Remote HTTPS MCP `https://rag2027.covaga.xyz/mcp`                                 |
| Optional RAGs: P8 2026 and EEC Pro 2026                               | same repository                                                                           | `https://rag2026.covaga.xyz/mcp`, `https://rageecpro.covaga.xyz/mcp`              |

Before touching the EPLAN integration, read eplan-mcp's `llm.md`: it describes everything the
server can do and configure. Facts about the MCP server that shape Bochica:

- It needs **64-bit Python 3.10+** (matching EPLAN's process) and the dependencies in its
  `requirements.txt` (`mcp`, `pythonnet`, `basyx-python-sdk`).
- It auto-detects the installed EPLAN version (2024–2027) under
  `C:\Program Files\EPLAN\Platform` (overridable with `EPLAN_PLATFORM_ROOT`).
- It is configured through environment variables (`EPLAN_MCP_MODE`, `EPLAN_MCP_LOG_DIR`,
  `EPLAN_MCP_EXTENSIONS`, `MCP_TRANSPORT`…). Bochica sets them; the user never does.
- EPLAN must have **File → Settings → Workstation → Interfaces → Remote access → "Allow remote
  access via Remote Client"** enabled. The app must detect when it is off and walk the user
  through it.

Design reference: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
(MIT), especially its desktop app (`apps/desktop`, Electron), its credential handling and its
update model. Hermes changes fast: check its current code before copying a decision.

## Branding (mandatory)

- Product name: **Bochica** / **Bochica by Canary-ECAD**. Never "EPLAN Electric", "EPLAN AI"
  or anything implying an official EPLAN product, and never "Claude Code" either.
- "EPLAN" may only appear descriptively (e.g. "works with EPLAN Electric P8"). Include the same
  disclaimer as the other Canary-ECAD repositories: independent project, not affiliated with
  EPLAN GmbH & Co. KG; EPLAN and EPLAN Electric P8 are trademarks of their owner.

## Languages

- Code, comments, commit messages, issues and this file: **English**.
- `README.md` is in English and is the source of truth. Translations live next to it as
  `README.<lang>.md` (starting with `README.es.md`), with a language switcher line at the top of
  each, as in eplan-mcp. A change to `README.md` updates every translation in the same commit.
- UI strings never go inline in components: they go through the i18n layer from day one
  (English and Spanish first), so new languages are just new translation files.

## Stack

Priority: strong typing and strict linting to catch mistakes before anything runs.

| Layer                     | Choice                                                      | Notes                                                                         |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Language                  | TypeScript `strict` everywhere                              | No implicit `any`; `noUncheckedIndexedAccess` on                              |
| Packages / scripts        | Bun (workspaces)                                            | Electron runs on Node; Bun is only the package manager and script/test runner |
| Desktop shell             | Electron                                                    | Same as Hermes and Claude Desktop. `safeStorage` (DPAPI) for secrets          |
| UI                        | React + Vite + Tailwind CSS + shadcn/ui + custom components |                                                                               |
| Routing / server state    | TanStack Router + TanStack Query                            | Zustand only if shared client state is needed                                 |
| Agent engine              | Own loop on top of the Vercel AI SDK (`ai` + `@ai-sdk/*`)   | Provider-agnostic; see "Agent engine"                                         |
| MCP client                | `@modelcontextprotocol/sdk`                                 | stdio for the EPLAN server, streamable HTTP for the RAGs                      |
| Persistence               | SQLite + Drizzle ORM                                        | Sessions, history, settings. No PostgreSQL: this is a local app               |
| Validation                | Zod                                                         | Shared schemas for IPC, config and tool arguments                             |
| Lint / format / dead code | oxlint · oxfmt · knip                                       |                                                                               |

## Architecture

Monorepo (one git repository with several packages, managed with Bun workspaces):

```text
apps/desktop/              Electron app, built with electron-vite
  src/main/                main process: agent, MCP, credentials, DB, updates
  src/preload/             typed IPC bridge (contextBridge), the only thing the UI can see
  src/renderer/            React UI; `@/` aliases src/renderer/src
packages/shared/           Zod schemas and IPC types shared by main and renderer
packages/agent/            agent loop, tools, skills, subagents, permissions (no Electron)
packages/eplan/            default EPLAN MCP/skill config and management of its Python runtime
components.lock.json       pinned versions of the EPLAN components (see "Updates")
```

How the pieces fit:

- Workspace packages ship TypeScript source (`exports` points at `src/index.ts`); there is no
  per-package build. Everything in `apps/desktop` is a **devDependency** on purpose:
  electron-vite bundles devDependencies into `out/`, while anything in `dependencies` is left
  external and must exist in `node_modules` at runtime. Only move a package to `dependencies`
  if it cannot be bundled (e.g. native modules).
- `apps/desktop/package.json` has no `"type": "module"`, so main and preload are emitted as
  CommonJS. Keep it that way: the preload runs with `sandbox: true`, which does not support
  ESM preloads. Use `__dirname`, not `import.meta.dirname`, in main.
- **IPC:** every channel is declared once in `packages/shared/src/ipc.ts` (channel name, Zod
  schema, and its method on `BochicaApi`). Main validates what it returns, preload validates
  what it receives and exposes `window.bochica`; the renderer only ever calls `window.bochica`.
  Adding a channel touches those three places plus `src/main/index.ts`.
- **Renderer:** TanStack Router with code-based routes in `router.tsx` and hash history (the
  packaged app loads `index.html` from disk). Server-ish state goes through TanStack Query
  wrapping `window.bochica` calls. Theme follows Windows light/dark via a `.dark` class on
  `<html>`; colors come only from the CSS tokens in `styles.css`.
- **UI components:** shadcn/ui (`components.json`, style new-york). Add components with the
  shadcn CLI from `apps/desktop`; they land in `src/renderer/src/components/ui`.
- **i18n:** strings live in `src/renderer/src/i18n/<lang>.json`; `en.json` is the reference and
  a test fails if another language has different keys. New language = new JSON + an entry in
  `supportedLanguages`.

`packages/agent` does not depend on Electron, so it can be tested with `bun test` and reused by
a future CLI.

### Agent engine

Provider-agnostic, like Hermes. The loop (message → tool calls → results → …) is our own; the
Vercel AI SDK is used only as the provider and streaming layer. Everything Claude Code ships out
of the box is implemented in `packages/agent`:

- **Providers:** Anthropic, OpenAI, Google, OpenRouter, and local OpenAI-compatible servers
  (Ollama, LM Studio). Adding a provider must not touch the loop.
- **Built-in tools:** read/write/edit files, search (glob/grep), PowerShell terminal, plus the
  tools of every connected MCP server.
- **Skills:** folders with a `SKILL.md`; only name and description go into the prompt, the body
  is loaded on demand.
- **Subagents, context compaction and per-tool permissions** (ask / allow for this session /
  always allow). Actions that modify the EPLAN project ask by default.

### Credentials

Provider-agnostic, following Hermes's design:

- **The main process alone owns credentials and child processes.** The renderer requests,
  displays status and starts flows over IPC; it never sees a token in clear text.
  `contextIsolation: true`, `nodeIntegration: false`.
- **API keys first** (M0): one field per provider, masked value, a "where do I get my key?"
  link and a **Test** button. Stored with `safeStorage`/DPAPI, with the source visible (app,
  environment variable…). The store supports several credentials per provider from the start.
- **OAuth** (M1): device code by default; PKCE with a loopback redirect (`127.0.0.1`, ephemeral
  port, system browser) only where a provider requires it. Never a `client_secret` in the app.
- **Never** a "Sign in with Claude" button, and never reuse other tools' logins (`~/.claude`,
  `~/.codex`): Anthropic is API key only.
- Secrets never reach prompts, logs, generated scripts or child-process environments (terminal,
  MCP) beyond what that specific process needs.

### Python runtime

Users never install Python, Node or MCP servers by hand. The installer bundles a **standalone
64-bit Python 3** (python-build-standalone) and **`uv`**, with the MCP server's dependencies
preinstalled, so it works offline and behind corporate proxies. When the pinned MCP version
changes, Bochica syncs its dependencies with `uv` into its own environment under
`%LOCALAPPDATA%`; it never uses or modifies a system Python. Failures (EPLAN not installed,
Remote Client disabled, proxy blocking a download…) are turned into messages that tell the user
exactly what to do.

### Updates

Unlike Hermes, where backend and frontend are updated separately, the user sees **a single
update** covering everything:

- On startup (and periodically) the app checks GitHub releases (`electron-updater`). If there
  is a new version it shows a non-blocking notice — "A new version is available" — with
  **Update now** and **Later**. Nothing updates silently, and never while the agent is running a
  task; "Later" applies it on the next restart.
- One click updates the UI, the agent and the EPLAN components together. The user never has to
  know there are separate parts.
- **The EPLAN components** (MCP server and skills) are **pinned** to exact commits in
  `components.lock.json`. Each Bochica release ships versions tested together; bumping one
  means editing the lock, testing and publishing a release, so a change on another repository's
  `main` can never break a user's app.
- If an update fails, the previous version keeps working and the user gets a plain message with
  a retry button.
- **The RAGs** are remote services: always the latest version, never pinned.

## Commands

Run from the repository root:

```bash
bun install                 # install dependencies for the whole monorepo
bun run dev                 # Electron + Vite with hot reload
bun run build               # production build into apps/desktop/out
bun run package             # Windows installer into apps/desktop/release (Python/uv not bundled yet)
bun run typecheck           # tsc --noEmit in every workspace (desktop: node + web configs)
bun run lint                # oxlint (.oxlintrc.json)
bun run format              # oxfmt, also formats Markdown and JSON
bun run format:check
bun run knip                # unused files, exports and dependencies (knip.json)
bun test                    # all tests (Bun test runner, *.test.ts next to the code)
bun test packages/eplan     # tests under a path
bun test -t "ids are unique"    # tests whose name matches
```

Before calling a change done: `typecheck`, `lint`, `format:check`, `knip` and `test` must pass.

Notes:

- TypeScript is 7.x (the native compiler). Settings are in `tsconfig.base.json`
  (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
  With `exactOptionalPropertyTypes`, passing `undefined` to an optional property is an error:
  omit the property instead.
- Test files are excluded from `tsconfig.web.json`; tests in the renderer must not touch the DOM.
- Electron downloads its binary on first launch, not during `bun install`.
- Pin exact dependency versions (no `^`), as the existing `package.json` files do.

## Platform

Windows only (EPLAN only exists on Windows). Paths, the installer and the secret store assume
Windows; do not add macOS/Linux code unless that decision changes.
