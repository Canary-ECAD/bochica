# S1 — Foundations and API keys

**Status:** done (S1-07 carried over to S2)
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

- [x] A React error boundary around the routes shows a friendly message (i18n) with a "Reload"
      button instead of a white screen.
- [x] Unhandled errors in main are logged to a file under the app's `logs` folder; secrets are
      never written (see S1-05 redaction helper).
- [x] Opening DevTools is possible in dev builds only.

### S1-03 · Credential store in main

Packages: shared, desktop (main).

- [x] A `CredentialStore` in main saves per-provider API keys encrypted with Electron
      `safeStorage` in a file under `userData`; writes are atomic (temp file + rename).
- [x] The data model follows the Credential sketch from Hermes: `id`, `provider`, `kind`
      (`api_key` only for now), `label`, `source` (`app` | `env`), `priority`, `status`.
      Several credentials per provider are allowed by the model even if the UI shows one.
- [x] Keys from environment variables (e.g. `ANTHROPIC_API_KEY`) are detected and shown as
      `source: env`, read-only.
- [x] Unit tests cover save/load/delete and atomic write, with `safeStorage` stubbed.

### S1-04 · Credentials over IPC, never in clear

Packages: shared, desktop (main + preload).

- [x] IPC channels `credentials:list`, `credentials:set`, `credentials:delete`,
      `credentials:test`, declared in `packages/shared/src/ipc.ts` with Zod schemas.
- [x] `list` returns only metadata plus a masked preview (`sk-ant-…a1b2`), never the key.
- [x] `test` makes the cheapest possible authenticated call to the provider (e.g. list models)
      from main and returns `ok` / `invalid` / `network_error` with a plain-language message.
- [x] A test asserts that no channel's response schema contains a field that could carry the
      raw key.

### S1-05 · Secret redaction helper

Packages: agent.

- [x] `redactSecrets(text)` masks known key shapes (`sk-…`, `sk-ant-…`, `AIza…`, `ghp_…`,
      bearer tokens, `key=`/`token=`/`password=` pairs).
- [x] Used by the main-process logger. Table-driven tests for each shape and for text that
      must stay untouched.

### S1-06 · Providers screen in Settings

Packages: desktop (renderer), agent.

- [x] Settings lists every provider from `@bochica/agent`'s catalog. API-key providers show a
      masked field, a "Where do I get my key?" link (opens the system browser), **Save**,
      **Test** and **Remove**. Local providers show their base URL and a **Test** button.
- [x] Test results appear inline with an icon and the plain-language message.
- [x] All strings exist in `en.json` and `es.json`.
- [x] Uses shadcn components (Input, Card, Badge as needed) added with the shadcn CLI.

### S1-07 · CI on GitHub

Packages: root.

- [ ] Public repository `Canary-ECAD/bochica` created and `main` pushed. _Needs the maintainer:
      creating a public repository requires an explicit permission._
- [ ] A GitHub Actions workflow runs `bun install --frozen-lockfile` and `bun run check` on
      `windows-latest` for pushes to `main` and for pull requests. _Written
      (`.github/workflows/check.yml`); tick once it has run green on GitHub._

## Demo

Open Settings → Providers, paste a real Anthropic key, press Test → "Connected". Paste a bad
key → "This key was rejected by Anthropic". Restart the app: the key is still there, masked.
Search the logs folder for the key: no match.

## Outcome

Closed 2026-10-27 with S1-07 still open (moved to S2 as S2-00).

- Shipped: `bun run check`; main-process log with redaction and crash handlers; error screen
  for render failures (router `defaultErrorComponent` + top-level boundary); DevTools disabled
  in packaged builds; `CredentialStore` (safeStorage, atomic writes, env keys read-only, corrupt
  file set aside); four credential IPC channels validated with Zod on both ends;
  `redactSecrets`/`maskSecret`; `testConnection` per provider; Providers section in Settings
  (en/es). 53 tests.
- Demo run against the built app with a **fake** Anthropic key: saved, masked as
  `sk-ant-…0000`, Test → "Anthropic rejected this key" (real 401 from the API), still there
  after a restart, and the key string appears in no file under the app's data folder, logs
  included. Not exercised: the "Connected" path with a real key, and the error screen (no
  route throws yet).
- Provider ids moved to `@bochica/shared` (`ProviderId`) so IPC schemas can validate them;
  `@bochica/agent` now depends on `@bochica/shared`.
- The shadcn CLI wrote `import { cn } from "cn"` and added `cn`/`radix-ui` as runtime
  dependencies; fixed by hand (see CLAUDE.md).
