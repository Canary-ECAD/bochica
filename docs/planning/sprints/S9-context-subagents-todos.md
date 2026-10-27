# S9 — Context compaction, subagents and the task list

**Status:** done
**Goal:** long conversations keep working, because Bochica summarises the older part before
the model's context fills up and shows how full it is; the agent can hand a research job to a
helper that only reads; and on longer jobs the user sees the agent's task list next to the
composer.

## Decisions

- **Context window** per model: from the provider's model list where it says so (OpenRouter
  `context_length`, Google `inputTokenLimit`), otherwise a default per provider (Anthropic
  200 000, OpenAI 128 000, Google 1 000 000, local servers 8 192, since Ollama and LM Studio
  start with small windows). `ModelInfo.contextWindow`, sent with each turn.
- **Usage:** the loop records the last model call's input and output tokens (what is really
  in the context, not the sum of every step). Main adds an estimate of how they split
  (instructions, tools, conversation; counted by characters and scaled to the real total) and
  the window, and saves it on the answer as `context`.
- **Compaction:** before a turn, main estimates the size of what it will send (characters ÷ 3.5,
  on the high side). Above 75 % of the window it summarises the
  older conversation with the same model, keeping the last two exchanges word for word. The
  summary goes on the turn's answer (`compaction: { summary, from }`) and `toHistory` (shared by
  main and the renderer) sends `summary + kept exchanges + new message` from then on; nothing is
  deleted, the user still sees every message. The activity log shows "Summarised the earlier
  conversation" with the summary on expand. `/compact` does it on demand, without a model
  answer. If summarising fails, the turn goes on uncompacted and the log says so.
- **Context meter:** a small ring in the composer with the percentage of the last turn;
  hovering shows used / window and the split, and says it compacts by itself at 75 %.
- **Subagents** (`bochica__task`): the model gives a short description and a full prompt; a
  helper runs with a fresh conversation, the same model, at most 10 steps, and **only the
  tools of the current mode that never ask and never change a project** (docs, reading and
  searching files, reading skills, EPLAN reads). No PowerShell, no writes, no nested helpers,
  no approval cards. It returns a report, which is all the main conversation gets; the log
  shows "Asked a helper: …" with the report and the tools it used. Several can run at once.
- **Task list** (`bochica__todo_write`): the model replaces the whole list each time
  (`pending` / `in_progress` / `completed`, one in progress at a time). The latest list of the
  session shows above the composer while anything is unfinished, and the log says "Updated the
  task list". Saved as an ordinary tool call, so it survives a restart. Every mode has it.
- **Persistence:** answers get a `meta` JSON column (migration 3) for `context` and
  `compaction`.
- **Moved out:** the full per-category "Context" popover with every MCP tool listed, exact
  token counting APIs per provider, and showing a helper's tool calls nested in the log →
  backlog.

## Tasks

### S9-01 · Context window and usage

Packages: shared, agent, desktop.

- [x] `ModelInfo.contextWindow` from OpenRouter and Google listings; `contextWindowFor(provider,
      info)` with the defaults; `ChatSendRequest.contextWindow`.
- [x] The loop reports the last step's tokens on `turn-end` (`contextTokens`); tests with the
      mock model over two steps.
- [x] `estimateContext` (instructions / tools / conversation) in agent; main saves
      `context: { used, window, instructions, tools, conversation }` on the answer
      (migration 3, `meta` column); repository test.

### S9-02 · Compaction

Packages: shared, agent, desktop (main).

- [x] `compactConversation(model, history, keep)` in agent (summary prompt: goals, decisions,
      EPLAN projects and pages touched, files changed, open questions, the user's
      preferences; in the user's language); tests with a mock model.
- [x] Turn event `compacted`; `applyTurnEvent` stores it; `toHistory` starts from the latest
      summary; `ChatMessage.id` so main knows which exchange the kept part starts at; tests.
- [x] `ChatService`: compact above 75 %, `/compact` (reserved command name), a log row,
      failures logged and the turn continues.

### S9-03 · Context meter

Packages: desktop (renderer).

- [x] A ring in the composer from the session's latest `context`, with a popover: used /
      window, the three parts, the 75 % note. `/compact` in the `/` menu. Strings in en and es.

### S9-04 · Task list

Packages: agent, desktop.

- [x] `todo_write` tool with input validation (at most 30 items, one in progress); the prompt
      says when to use it; tests.
- [x] Panel above the composer with the latest list while something is unfinished; log
      sentence in en and es; pure `currentTodos(messages)` with tests.

### S9-05 · Subagents

Packages: agent, desktop.

- [x] `subagentTool({ model, tools, system })`: read-only filter, fresh history, 10 steps,
      stops with the turn, report plus the tools used; no `task` inside a helper; tests with a
      mock model (a helper that calls a read tool, then reports; a write tool is never offered).
- [x] `ChatService` gives it to every mode with that mode's read-only tools; log sentence in
      en and es.

## Demo

With the fake model and a tiny context window: a few long messages trigger "Summarised the
earlier conversation", the next request carries the summary instead of the old messages, and
the old messages are still on screen. The ring shows the percentage and the split. `/compact`
works on demand. The fake model writes a three-item task list: it shows above the composer and
updates as items complete, and disappears when all are done. It calls `task`: the log shows
"Asked a helper", the helper's request had only read-only tools, and the report reaches the
main conversation.

## Outcome

Closed 2026-10-27.

- Shipped: `ModelInfo.contextWindow` (OpenRouter, Google) and `contextWindowFor` defaults; the
  loop's `contextTokens` (last model call); `estimateContext` / `contextUsage`; turn events
  `context` and `compacted`, saved in the new `meta` column (migration 3); `toHistory` starting
  from the latest summary, with `ChatMessage.id`; `compactConversation`; `/compact`; the
  context ring with its popover; `todo_write` and the task panel; `bochica__task` helpers with
  `helperCanUse`; a "Longer jobs" section in the prompt. 494 tests.
- Decisions taken while building: automatic compaction only runs when there are more exchanges
  than the two it keeps (with a local model's 8 192 window and Consult's guides, the prompt
  alone can pass 75 %, and a summary would save nothing); a long transcript to summarise loses
  its oldest part but never the previous summary; the parts of the ring keep instructions and
  tools as estimated and count what the turn added as conversation; the estimate is not
  calibrated with the last real count (it errs high, which only means compacting a little
  early).
- Demo on the built app with a fake LM Studio that reports usage (window 8 192, isolated
  user-data folder, Spanish UI): "haz las tareas…" showed the three-step list above the composer
  and the ring at 15 %; "avanza" moved it to 2 of 3; "termina" hid it. "investiga…" made the
  model call `task`: the helper's request had only the docs, skill and read/list/search tools
  (no writes, PowerShell, `todo_write` or `task`), it read `motores.txt` and its report reached
  the conversation. Three long messages pushed the ring to 37 %, 59 % and 81 %; the second and
  third turns were compacted ("Summarised the earlier conversation", summary on expand), the
  model got the summary, the two kept exchanges and the new message, and the first messages
  were still on screen. The popover showed 6 643 of 8 192 with the split. `/compact` from the
  menu summarised everything (the ring went to 38 %) and the next request was summary + new
  message. After a restart the reopened session still started from the summary.
- Found and fixed during the demo: summarising a very long conversation dropped the previous
  summary when it cut the transcript.
- Not exercised: a real model deciding to use `todo_write` or `task` (the fake model was
  scripted), and providers' own usage numbers other than the OpenAI-compatible one.
