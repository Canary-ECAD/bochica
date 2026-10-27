# S2 — Streaming chat

**Status:** done (S2-00 carried over to S3)
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

- [x] `runTurn()` takes the conversation, a model handle and an abort signal, and yields typed
      events (`text-delta`, `turn-end`, `error`) using the Vercel AI SDK (`ai` 7.x) for
      streaming. No provider-specific branches outside the provider catalog.
- [x] Provider adapters for Anthropic, OpenAI, Google, OpenRouter and OpenAI-compatible local
      servers, built from the catalog entry plus a key supplied by the caller.
- [x] Tests run the loop against the AI SDK's mock model.

### S2-02 · Turn streaming over IPC

Packages: shared, desktop (main + preload).

- [x] `chat:send` starts a turn in main (main fetches the key itself); events stream to the
      renderer over a dedicated channel, each validated with Zod.
- [x] `chat:stop` aborts the running turn; the partial answer is kept and marked as stopped.

### S2-03 · Message view

Packages: desktop (renderer).

- [x] User and assistant messages render with Markdown (code blocks with syntax highlighting
      and a copy button), auto-scroll that pauses when the user scrolls up.
- [x] The composer: Enter sends, Shift+Enter adds a line, Stop button while streaming.
- [x] Errors (bad key, rate limit, offline) appear as an inline message with a "Go to Settings"
      or "Retry" action, never a raw stack trace.

### S2-04 · Model picker

Packages: desktop (renderer), agent.

- [x] A picker in the composer lists providers with a working credential and their models; the
      last choice is remembered.
- [x] With no credential configured, the composer shows a call to action to Settings instead of
      the picker.

### S2-05 · In-memory sessions

Packages: desktop.

- [x] "New session" starts an empty conversation; sessions appear in the sidebar's Recent list
      for the life of the app (persistence comes in S5).

## Demo

With a key from S1, ask "Explain in two sentences what a macro is in EPLAN" and watch it stream.
Press Stop halfway: the partial answer stays. Switch provider and ask again in a new session.

## Outcome

Closed 2026-10-27 with S2-00 still open (moved to S3).

- Shipped: `runTurn` on `streamText` (AI SDK 7) with error classification and redaction;
  `createModel`/`listModels` for all six providers (models are listed live from each provider,
  no hard-coded model ids); `chat:send`/`chat:stop`/`chat:event`/`models:list` IPC; zustand
  session store; Markdown with GFM and highlight.js; composer with model picker (searchable,
  grouped by provider, last choice persisted); error cards with Retry / Go to Settings. 82 tests.
- `@bochica/agent/catalog` is a separate entry so the renderer never bundles the SDKs
  (verified in the built bundle).
- Demo run on the built app against a **local fake OpenAI-compatible server** standing in for
  LM Studio (no real provider key available): the model appeared in the picker, the answer
  streamed, Stop kept the partial answer marked "Stopped", a full answer rendered Markdown and a
  highlighted C# block, the view stayed pinned to the bottom and offered "Jump to latest" when
  scrolled up, and a forced 429 showed the rate-limit card with Retry. Not exercised: a real
  cloud provider, the copy button, "Go to Settings" for a rejected key, and the remembered model
  across a restart.
- Known: a 429 takes ~9 s to surface because the SDK retries twice first. The renderer bundle
  is 2.4 MB, mostly highlight.js languages; lazy-loading them is a later optimisation.
