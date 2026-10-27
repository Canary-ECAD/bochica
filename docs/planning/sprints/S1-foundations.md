# S1 — Foundations and API keys

**Status:** active
**Goal:** a reliable quality gate, sane error handling, and API keys that the user can add,
test and remove from Settings without the renderer ever seeing a key.

Design reference: "Credentials" in [CLAUDE.md](../../../CLAUDE.md).

## Tasks

### S1-01 · One command for every check

Packages: root.

- [x] `bun run check` runs typecheck, lint, format check, knip and tests, and fails on the first
      error.
- [x] CLAUDE.md tells contributors to run it before calling a change done.

### S1-02 · Errors never leave a blank window

Packages: desktop.

- [ ] A React error boundary around the routes shows a friendly message (i18n) with a "Reload"
      button instead of a white screen.
- [ ] Unhandled errors in main are logged to a file under the app's `logs` folder; secrets are
      never written (see S1-05 redaction helper).
- [ ] Opening DevTools is possible in dev builds only.

### S1-03 · Credential store in main

Packages: shared, desktop (main).

- [ ] A `CredentialStore` in main saves per-provider API keys encrypted with Electron
      `safeStorage` in a file under `userData`; writes are atomic (temp file + rename).
- [ ] The data model follows the Credential sketch from Hermes: `id`, `provider`, `kind`
      (`api_key` only for now), `label`, `source` (`app` | `env`), `priority`, `status`.
      Several credentials per provider are allowed by the model even if the UI shows one.
- [ ] Keys from environment variables (e.g. `ANTHROPIC_API_KEY`) are detected and shown as
      `source: env`, read-only.
- [ ] Unit tests cover save/load/delete and atomic write, with `safeStorage` stubbed.

### S1-04 · Credentials over IPC, never in clear

Packages: shared, desktop (main + preload).

- [ ] IPC channels `credentials:list`, `credentials:set`, `credentials:delete`,
      `credentials:test`, declared in `packages/shared/src/ipc.ts` with Zod schemas.
- [ ] `list` returns only metadata plus a masked preview (`sk-ant-…a1b2`), never the key.
- [ ] `test` makes the cheapest possible authenticated call to the provider (e.g. list models)
      from main and returns `ok` / `invalid` / `network_error` with a plain-language message.
- [ ] A test asserts that no channel's response schema contains a field that could carry the
      raw key.

### S1-05 · Secret redaction helper

Packages: agent.

- [ ] `redactSecrets(text)` masks known key shapes (`sk-…`, `sk-ant-…`, `AIza…`, `ghp_…`,
      bearer tokens, `key=`/`token=`/`password=` pairs).
- [ ] Used by the main-process logger. Table-driven tests for each shape and for text that
      must stay untouched.

### S1-06 · Providers screen in Settings

Packages: desktop (renderer), agent.

- [ ] Settings lists every provider from `@bochica/agent`'s catalog. API-key providers show a
      masked field, a "Where do I get my key?" link (opens the system browser), **Save**,
      **Test** and **Remove**. Local providers show their base URL and a **Test** button.
- [ ] Test results appear inline with an icon and the plain-language message.
- [ ] All strings exist in `en.json` and `es.json`.
- [ ] Uses shadcn components (Input, Card, Badge as needed) added with the shadcn CLI.

### S1-07 · CI on GitHub

Packages: root.

- [ ] Public repository `Canary-ECAD/bochica` created and `main` pushed.
- [ ] A GitHub Actions workflow runs `bun install --frozen-lockfile` and `bun run check` on
      `windows-latest` for pushes to `main` and for pull requests.

## Demo

Open Settings → Providers, paste a real Anthropic key, press Test → "Connected". Paste a bad
key → "This key was rejected by Anthropic". Restart the app: the key is still there, masked.
Search the logs folder for the key: no match.

## Outcome

_(fill in when the sprint closes)_
