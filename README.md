<p align="center"><img src="apps/desktop/build/icon.png" alt="Bochica logo" width="112"></p>

# Bochica

**English** · [Español](README.es.md)

**Bochica by Canary-ECAD** is an open source Windows desktop app that lets anyone work with
EPLAN Electric P8 through an AI agent — no programming, no command line. Install it, paste an
API key from the AI provider of your choice, and describe what you want in your own words.

> **Status:** early development, not released yet. It already chats with any provider, answers
> from the EPLAN documentation, acts on EPLAN with your approval, works with files and
> PowerShell in a folder you choose, and takes your own skills. The installer carries everything
> it needs; automatic updates are still missing.

## What it includes

- A clean chat interface with sessions, in the style of modern AI coding assistants.
- Works with Anthropic, OpenAI, Google Gemini, OpenRouter, or local models (Ollama, LM Studio).
- Ready-made EPLAN integration, nothing to configure:
  - [eplan-mcp](https://github.com/Canary-ECAD/eplan-mcp) — drives a running EPLAN instance.
  - [eplan-scripting-skill](https://github.com/Canary-ECAD/eplan-scripting-skill) — teaches the
    agent to write correct EPLAN Electric P8 scripts.
  - [eec-pro-skill](https://github.com/Canary-ECAD/eec-pro-skill) — the same for EPLAN EEC Pro
    (typicals, formulas, Job Server, generation).
  - [eplan-cloudflare-rags](https://github.com/Canary-ECAD/eplan-cloudflare-rags) — searches the
    EPLAN documentation (P8 2027 always on; P8 2026 and EEC Pro optional).
- Undo: rewind to an earlier message and the files the agent changed go back as they were.
- Plan first, or let it work: ask for a plan to approve before anything changes, decide what is
  always allowed or never allowed, or switch a session to Auto.
- One-click updates.

## Requirements

- Windows 10 or 11 (64-bit).
- EPLAN Electric P8 2024–2027, with **File → Settings → Workstation → Interfaces → Remote
  access → "Allow remote access via Remote Client"** enabled.
- An API key from a supported provider, or a local model server.

Nothing else: the installer carries its own Python with the EPLAN server and the built-in
skills, so it downloads nothing to get started (a corporate proxy is no problem) and never touches a Python you may
have installed. On first start a short guide connects a model, checks EPLAN and asks a first
question.

## Updates

Bochica looks for a new version on its own. When there is one, a notice at the bottom of the
sidebar offers **Update now** (download, restart, done; it waits for a running task to finish)
or **Later** (it installs the next time you close Bochica). One update covers everything: the
app and the EPLAN components it carries. Nothing updates without one of those clicks, and if an
update fails, the installed version keeps working. Settings → General → Updates shows the
version and can check right away.

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Checks: `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run knip`, `bun test`.
See [CLAUDE.md](CLAUDE.md) for the architecture.

`bun run package` builds the installer in `apps/desktop/release`. Its first step,
`bun run --filter @bochica/desktop runtime`, downloads the pinned Python, eplan-mcp and the
skills into `apps/desktop/runtime` and checks that the EPLAN server starts; `bun run dev` uses
that folder too once it exists. Releases are built by CI from a version tag; the steps, and how
to bump an EPLAN component, are in [docs/releasing.md](docs/releasing.md).

## License

MIT — see [LICENSE](LICENSE).

> **Disclaimer:** this is an independent community project by
> [Canary E-cad](https://github.com/Canary-ECAD). It is not affiliated with, endorsed by, or
> supported by EPLAN GmbH & Co. KG. EPLAN, EPLAN Electric P8 and EPLAN EEC Pro are trademarks of
> their respective owner.
