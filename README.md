# Bochica

**English** · [Español](README.es.md)

**Bochica by Canary-ECAD** is an open source Windows desktop app that lets anyone work with
EPLAN Electric P8 through an AI agent — no programming, no command line. Install it, paste an
API key from the AI provider of your choice, and describe what you want in your own words.

> **Status:** early development. The app shell runs; the agent is not connected yet.

## What it includes

- A clean chat interface with sessions, in the style of modern AI coding assistants.
- Works with Anthropic, OpenAI, Google Gemini, OpenRouter, or local models (Ollama, LM Studio).
- Ready-made EPLAN integration, nothing to configure:
  - [eplan-mcp](https://github.com/Canary-ECAD/eplan-mcp) — drives a running EPLAN instance.
  - [eplan-scripting-skill](https://github.com/Canary-ECAD/eplan-scripting-skill) — teaches the
    agent to write correct EPLAN scripts.
  - [eplan-cloudflare-rags](https://github.com/Canary-ECAD/eplan-cloudflare-rags) — searches the
    EPLAN documentation (P8 2027 always on; P8 2026 and EEC Pro optional).
- One-click updates.

## Requirements

- Windows 10 or 11 (64-bit).
- EPLAN Electric P8 2024–2027, with **File → Settings → Workstation → Interfaces → Remote
  access → "Allow remote access via Remote Client"** enabled.
- An API key from a supported provider, or a local model server.

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Checks: `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run knip`, `bun test`.
See [CLAUDE.md](CLAUDE.md) for the architecture.

## License

MIT — see [LICENSE](LICENSE).

> **Disclaimer:** this is an independent community project by
> [Canary E-cad](https://github.com/Canary-ECAD). It is not affiliated with, endorsed by, or
> supported by EPLAN GmbH & Co. KG. EPLAN, EPLAN Electric P8 and EPLAN EEC Pro are trademarks of
> their respective owner.
