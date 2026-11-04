# S13b — Claude Agent: a Claude Pro or Max plan as a provider

**Status:** done
**Goal:** someone with a Claude Pro or Max plan and Claude Code installed picks **Claude Agent**
in the model picker and works with Bochica on that plan, with every Bochica tool, approval card
and guardrail working as with any other provider.

## Decisions

- **Same approach as OpenCode** (2.2.3, October 2026): Bochica runs the user's own Claude Code
  through Anthropic's Claude Agent SDK, and Claude Code uses the plan the user signed in with
  (`claude auth login`). Bochica never reads, stores or sends that login. Asked by the
  maintainer after weighing it: Anthropic's Agent SDK page says third-party developers may not
  offer claude.ai login "unless previously approved", and Bochica has no such approval. The app
  says so in the provider card, as OpenCode's docs do.
- **Bochica stays provider-agnostic.** Claude Agent is one more provider behind the same loop
  (`runTurn`). Claude Code's own tools are switched off (`tools: []`); Bochica's tools reach it
  through an in-process MCP server and run through `runTool`, so assessment, approval cards,
  typed confirmation, backups, checkpoints, redaction and truncation are the ones every provider
  gets. The model sees them as `mcp__b__…`.
- **Claude Code runs isolated:** no user or project settings (`settingSources: []`), no skills
  (`skills: []`), no other MCP servers (`strictMcpConfig`), no auto memory, no saved transcript
  (`persistSession: false`), Bochica's own system prompt, and a filtered environment (the
  terminal's `safeEnv`, so no API key rides along and the plan is used).
- **One model call is a whole Claude Code run.** Claude Code drives the tool round-trips itself,
  so the AI SDK sees one call that streams text, provider-executed tool calls and their results.
  Each tool call is matched to its approval card by the id Claude Code sends with the MCP call
  (`claudecode/toolUseId`). Which tools a call may use, and which approver answers, come from the
  `runTurn` that made it (a registry keyed by an id in `providerOptions`), so a helper keeps its
  own rules.
- **History** goes as a transcript in the prompt (earlier exchanges, then the new message); no
  Claude Code session is kept between turns. Rewind and compaction keep working unchanged.
- **Claude Code must be installed** (the native Windows install, `claude.exe` in
  `%USERPROFILE%\.local\bin` or on `PATH`). Bochica doesn't ship it. The card says how to
  install it and sign in; **Test** runs `claude auth status`. Models come from Claude Code itself
  (`supportedModels()`), never hard-coded.
- **The SDK is not MIT** (© Anthropic, Commercial Terms). It is an npm dependency bundled into the
  app like the AI SDK; its platform binaries are not shipped.
- **Branding:** the provider is "Claude Agent" (Anthropic's allowed name), never "Claude Code".

## Tasks

### S13b-01 · Claude Agent model

Packages: agent (`claude-agent.ts`, `turn-tools.ts`, `loop.ts`, `models.ts`, `providers.ts`),
shared.

- [x] Provider `claude-agent` (`auth: "claude_code"`), context window default.
- [x] `runTurn` registers its tools and approver for the model calls it makes.
- [x] `claudeAgentModel` maps a run to stream parts: text, provider-executed tool calls with
      results from `runTool`, usage, finish; errors (signed out, rate limit, no credit) become
      the usual error codes.
- [x] Tests with a fake run: text, a tool that asks and gets its card under the right id, a
      denied tool, a helper's tools, errors, transcript of earlier exchanges.

### S13b-02 · Claude Code on this computer

Packages: agent (`claude-code.ts`), desktop (main).

- [x] Find `claude.exe`, read `claude auth status`, list models, and run a query with the
      isolation above; `ChatService`, `models:list` and `credentials:test` use it.
- [x] `ConnectionResult` gains `not_installed` and `signed_out`.

### S13b-03 · Settings and picker

Packages: desktop (renderer), i18n.

- [x] Claude Agent card: what it is, the not-officially-supported note, install and sign-in
      steps, Test. The picker lists it like a local provider.

### S13b-04 · Docs

- [x] CLAUDE.md (credentials, agent engine), README (+es), this file's outcome.

## Demo

On the built app with Claude Code installed and signed in: Settings → Claude Agent → Test says
connected; the picker lists Claude Code's models; in Consult a question is answered; in Tasks a
tool that asks shows its card and runs after approval; a denied call is reported as denied.

## Outcome

- **Shipped:** the Claude Agent provider. Claude Code runs isolated with its own tools off;
  Bochica's tools reach it through an in-process MCP server and run through `runTool`, so cards,
  typed confirmation, backups, checkpoints and redaction are unchanged. Settings has its card
  (with the not-officially-supported note), Test runs `claude auth status`, and the picker lists
  Claude Code's own models.
- **Demo** on the built app with Claude Code 2.1.312 installed and signed in: Test said connected;
  the picker listed 13 models from Claude Code; with Haiku 5.5 a question in Consult was
  answered; asking for the dev-only `dev_echo` showed the usual approval card, "Allow once" ran
  it and the answer quoted its result; a second call was denied and the model said so without
  retrying, which also showed the history reaching the next turn. No error in the log and no
  transcript written to Claude Code's projects folder.
- **Learned on the way:** Claude Code sends the id of its tool_use block with each MCP call
  (`claudecode/toolUseId`), which keeps approval cards matched without guessing. With
  `settingSources: []` it still discovers the user's skills; `skills: []` hides them and, with no
  Skill tool, they can't be used.
- **Left out:** keeping a Claude Code session between turns (cheaper on long chats; today each
  turn sends a transcript), images, and Claude Code's thinking shown in the log. Context usage
  is the sum of the run's calls, so the ring reads high on turns with many tool calls.
