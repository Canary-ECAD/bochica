# S2 — Streaming chat

**Status:** active
**Goal:** the user picks a provider and model, types a message and watches the answer stream in,
in a message view that looks and feels like Claude Code Desktop. No tools yet.

## Tasks

### S2-00 · Publish and CI (carried over from S1-07)

Packages: root.

- [ ] Public repository `Canary-ECAD/bochica` created and `main` pushed (needs the maintainer's
      permission).
- [ ] `.github/workflows/check.yml` has run green on GitHub.

### S2-01 · Agent loop skeleton

Packages: agent.

- [ ] `runTurn()` takes the conversation, a model handle and an abort signal, and yields typed
      events (`text-delta`, `turn-end`, `error`) using the Vercel AI SDK (`ai` 7.x) for
      streaming. No provider-specific branches outside the provider catalog.
- [ ] Provider adapters for Anthropic, OpenAI, Google, OpenRouter and OpenAI-compatible local
      servers, built from the catalog entry plus a key supplied by the caller.
- [ ] Tests run the loop against the AI SDK's mock model.

### S2-02 · Turn streaming over IPC

Packages: shared, desktop (main + preload).

- [ ] `chat:send` starts a turn in main (main fetches the key itself); events stream to the
      renderer over a dedicated channel, each validated with Zod.
- [ ] `chat:stop` aborts the running turn; the partial answer is kept and marked as stopped.

### S2-03 · Message view

Packages: desktop (renderer).

- [ ] User and assistant messages render with Markdown (code blocks with syntax highlighting
      and a copy button), auto-scroll that pauses when the user scrolls up.
- [ ] The composer: Enter sends, Shift+Enter adds a line, Stop button while streaming.
- [ ] Errors (bad key, rate limit, offline) appear as an inline message with a "Go to Settings"
      or "Retry" action, never a raw stack trace.

### S2-04 · Model picker

Packages: desktop (renderer), agent.

- [ ] A picker in the composer lists providers with a working credential and their models; the
      last choice is remembered.
- [ ] With no credential configured, the composer shows a call to action to Settings instead of
      the picker.

### S2-05 · In-memory sessions

Packages: desktop.

- [ ] "New session" starts an empty conversation; sessions appear in the sidebar's Recent list
      for the life of the app (persistence comes in S5).

## Demo

With a key from S1, ask "Explain in two sentences what a macro is in EPLAN" and watch it stream.
Press Stop halfway: the partial answer stays. Switch provider and ask again in a new session.

## Outcome

_(fill in when the sprint closes)_
