# S13 — Several keys per provider, OpenRouter sign-in

**Status:** done
**Goal:** a provider can hold several keys, in the order the user wants, and a key that is
rejected, rate-limited or out of credit hands the call to the next one without the user noticing
more than a status in Settings. OpenRouter users can sign in with the browser instead of
copying a key.

## Decisions

- **OAuth only where a provider offers it to apps like Bochica.** Checked against Hermes
  (`hermes_cli/auth_*.py`, `agent/credential_pool.py`) and each provider:
  - **OpenRouter** has a public PKCE flow for third-party apps: the browser goes to
    `openrouter.ai/auth` with a loopback `callback_url`, and `POST /api/v1/auth/keys` swaps the
    code for a normal, user-owned API key (no refresh token, no client id, no secret). Bochica
    uses it: a loopback server on `127.0.0.1`, an ephemeral port, the system browser. OpenRouter
    echoes no `state`, so a random nonce rides in the callback path (as Hermes does); any other
    path is a 404 and never reaches the exchange.
  - **Anthropic:** API key only (CLAUDE.md). Hermes's Anthropic OAuth is a Claude subscription
    login; Bochica never offers one.
  - **OpenAI:** the only sign-in is ChatGPT's, through the Codex CLI's client id. Using another
    tool's client is reusing its login, which CLAUDE.md rules out. API key only.
  - **Google:** OAuth for Gemini needs a Google Cloud client of our own, and Google's device
    flow needs a client secret, which never goes in the app. API key only.
  - **Ollama, LM Studio:** no credentials.

  So no provider gets the **device code** flow in this sprint: none of them offers it without a
  secret or another tool's client. It is built when a provider needs it (backlog).

- **The sign-in result is a key like any other.** OpenRouter's key is stored, tested, ordered
  and removed like a pasted one; only its label says where it came from. The user can revoke it
  on openrouter.ai like any key.
- **Several keys per provider, in order.** Each key has a label the user can change ("Work",
  "Personal"; a new one gets "Key 2") and a place in the order. Keys saved in the app come
  first, in the user's order; keys from environment variables follow, read-only, as today.
- **Failover per model call, not per turn.** The model a turn uses is a wrapper over the
  provider's keys: each call (`doStream` / `doGenerate`) goes to the first usable key, and when
  the provider refuses it before answering, the same call is sent with the next key. Nothing of
  that call reached the user yet, so nothing is repeated, also in the middle of a turn after
  tool calls. Compaction, helpers and smart approval use the same wrapper. Which refusals move
  on:
  - **401 / 403** (rejected): the key is marked `invalid` (saved) and skipped by later calls;
  - **429** (rate limit): skipped for 60 s;
  - **402** (no credit, as OpenRouter says it): skipped for an hour;
  - anything else (a bad request, a server error, a network failure) is not about the key and
    goes back to the loop as today.

  When every key is being skipped, the call goes to the first one alone, so the SDK's own
  retries behave as with one key. A call that succeeds marks its key `ok`. Pauses live in
  memory: a restart tries every key again.

- **Settings shows what happens.** Each key shows its status (connected, rejected, paused until
  a time, not tested) and the key in use is marked. A provider's own prompt cache is per key, so
  a switch can make the next call slower and dearer; `docs` say so, the UI doesn't.
- **The renderer never sees a key** (unchanged): it sends a pasted key once, and for a sign-in
  it only starts and cancels the flow. The page the browser shows after the redirect takes its
  two sentences from the renderer, so it is in the user's language.

## Tasks

### S13-01 · Keys in order

Packages: shared (`ipc.ts`), desktop (main `credentials.ts`).

- [x] `CredentialStore.add(provider, secret, label)` appends a key (no more replacing);
      `update(id, { label?, position? })` renames or moves a key among the provider's app keys;
      `remove` as before. `list()` returns keys in use order, env keys last.
- [x] `pool(provider)` gives the keys in order for the failover; pauses (`limitedUntil`) in
      memory; `report(id, outcome)` records `ok`, `invalid`, `rate_limit` or `quota`.
      `CredentialInfo` gains `limitedUntil` (optional).
- [x] Files written by earlier versions load unchanged (one key per provider, priority 0).
- [x] Tests: order, rename, move, remove, report and pauses, env keys last and read-only.

### S13-02 · Failover per model call

Packages: agent (`pool.ts`, `models.ts`, `loop.ts`), shared.

- [x] `pooledModel(provider, modelId, pool, build)` wraps `doStream` and `doGenerate` with the
      rules above; `createModel(provider, pool, modelId)` returns it (local servers get a pool of
      one empty key).
- [x] A 402 is its own error code, `quota`, with its sentence in en and es.
- [x] Tests with `MockLanguageModelV4`: a rejected first key hands over, a 429 pauses, a 402
      pauses longer, a 500 does not move on, every key paused tries only the first, success
      marks `ok`.

### S13-03 · Main uses the pool

Packages: desktop (main `chat.ts`, `ipc.ts`), shared, preload.

- [x] `ChatService` builds the turn's model with `pooledModel`; "no key" stays as it is.
- [x] IPC: `credentials:set` adds a key with a label; new `credentials:update`;
      `credentials:test` takes `{ provider, id? }` and tests that key (or the one in use).
      `models:list` uses the key in use.

### S13-04 · Settings: a list of keys

Packages: desktop (renderer `provider-settings.tsx`, i18n).

- [x] Each provider card lists its keys: label (editable), masked preview, status (paused until
      HH:MM included), "in use" mark, move up / down, Test, Remove. Env keys show their variable
      and can only be tested.
- [x] "Add key" with an optional label; the first key needs no extra click (the welcome guide
      keeps working with the same card).
- [x] Strings in en and es.

### S13-05 · Sign in with OpenRouter

Packages: agent (`oauth.ts`, `providers.ts`), desktop (main, renderer), shared, preload.

- [x] `providers.ts` says which providers have a sign-in (`login`, OpenRouter's URLs);
      `pkceLogin` in `@bochica/agent` runs the loopback flow: verifier and S256 challenge,
      `127.0.0.1` on an ephemeral port, nonce in the path, browser opened by the caller, code
      exchanged for the key; 5 min timeout and cancel.
- [x] IPC `credentials:login` (provider, label, the page's two sentences) saves the key as a new
      one and returns how it ended (`LoginResult`: ok with the list, or denied, timeout,
      cancelled, failed, busy); `credentials:login-cancel`. Only one sign-in at a time.
- [x] The card shows **Sign in with OpenRouter** next to the key field, a waiting state with
      Cancel, and plain messages for denied, expired and failed exchanges.
- [x] Tests against a fake OpenRouter on `127.0.0.1`: success, wrong path is 404, denied,
      exchange refused, timeout, cancel. The key never appears in an error.

### S13-06 · Docs

- [x] CLAUDE.md (Credentials, main process), README and README.es if they describe keys,
      BACKLOG (device code, pool strategies left out), this file's outcome.

## Demo

On the built app, with throwaway keys: OpenAI gets two keys ("Work", a bogus one first, and a
second); Test on the bogus one says rejected. Reorder, rename and remove work and survive a
restart. The failover itself is shown by the tests (a real 429 can't be produced on demand).
The OpenRouter card shows **Sign in with OpenRouter**; the flow is covered by the fake server
tests, and a real sign-in is left to the maintainer.

## Outcome

- **Shipped:** several keys per provider in the user's order (add with a label, rename, move,
  remove, test each one), failover per model call on 401/403, 429 and 402 with pauses shown in
  Settings, the `quota` error code, and **Sign in with OpenRouter** (PKCE, loopback on
  `127.0.0.1`, nonce in the path). Tests: `pool.test.ts`, `oauth.test.ts` (a fake OpenRouter on
  `127.0.0.1`), `credentials.test.ts`, `logins.test.ts`.
- **Demo** on the built app with a throwaway profile and made-up OpenAI keys: three keys added
  through the form ("Key 1", "Trabajo", "Key 3"); Test on "Key 1" got OpenAI's 401, the row said
  rejected and "in use" moved to the next key; "Trabajo" moved up, "Key 3" renamed to
  "Personal", "Key 1" removed; after a reload the list, the order and the labels were the same,
  and `credentials.json` held no key in clear. The OpenRouter card shows the sign-in button.
- **Not shown live:** a real 429 or 402 (can't be produced on demand; the tests cover the
  failover) and a real OpenRouter sign-in, which opens the user's browser and needs an account:
  left to the maintainer before the next release.
- **Changed from the plan:** `credentials:login` returns how the sign-in ended instead of
  rejecting, so the renderer can say it in the user's language.
- **Moved to the backlog:** device code, other rotation strategies, a note in the chat when a
  call moved to another key.
