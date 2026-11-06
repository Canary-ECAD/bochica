# S14 — eplan-mcp contract

**Status:** done
**Goal:** eplan-mcp says what each of its tools does, and Bochica reads it instead of guessing.
A new eplan-mcp version arrives as a tagged release whose tool changes can be read before
bumping, and Bochica notices that release on its own. The two repositories stay separate.

## Decisions

- **Separate repositories, integrated by contract.** eplan-mcp keeps its own users (Claude
  Desktop, Claude Code, Cursor, VS Code), its own language (Python + pythonnet) and its own
  release pace. Bochica stays the integrator: it pins a version, bundles it and adds its
  guardrails. Merging the two (`git subtree`) is reconsidered only if eplan-mcp stops being used
  outside Bochica and most changes touch both repositories.
- **eplan-mcp states facts, Bochica decides policy.** Every tool carries the standard MCP
  annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), which
  every MCP client understands, plus a few EPLAN facts in the tool's `_meta` under the key
  `canary-ecad/eplan`:
  - `changesProject`: writes the open project (Bochica backs it up first);
  - `runsCode`: runs scripts, actions or add-ins;
  - `changesEplan`: changes EPLAN itself (settings, parts database, master data, ribbon);
  - `projectArgument`: the argument that names the project, for typed confirmation.

  Approval levels (`never`, `ask`, `always`) remain Bochica's: they belong to its guardrails,
  not to the server.

- **Seeded from today's classification.** The first annotated release takes its values from
  `tool-policy.ts`, so the switch changes no behaviour. Any difference is a decision, written in
  the sprint's outcome.
- **Annotations are trusted because the version is pinned.** The fixture records them, so a
  bump shows every annotation that changed, and a tool that becomes read-only is flagged loudly.
  A tool without annotations keeps today's default: ask, with a backup.
- **Overrides stay possible.** `tool-policy.ts` shrinks to the tools where Bochica wants
  something other than what the facts give, each with a one-line reason.
- **Versions are tags.** eplan-mcp publishes semver tags (`vX.Y.Z`) with notes listing added,
  changed and removed tools. Bochica pins the tag and its commit, so the lock stays exact.
- **Bochica watches for releases itself.** A scheduled workflow in Bochica compares eplan-mcp's
  latest release with the pin and opens an issue. No token crosses repositories.

## Tasks

### S14-01 · Annotations in eplan-mcp

Repository: Canary-ECAD/eplan-mcp.

- [x] Every tool declares the four MCP annotations and the `canary-ecad/eplan` facts above,
      seeded from Bochica's `tool-policy.ts`. Check that the pinned Python SDK (`mcp<2`) can set
      `_meta` on a tool; if it can't, say so in this file and find another place for the facts
      before going on. It can from mcp 1.19.0 (`FastMCP.tool(meta=…)`, sent as `_meta`);
      eplan-mcp now requires `mcp>=1.19.0,<2`.
- [x] A test in eplan-mcp fails when a tool has no annotations or no facts.
- [x] `llm.md` and the README document the annotations and the `_meta` key for other clients.

### S14-02 · Tagged releases of eplan-mcp

Repository: Canary-ECAD/eplan-mcp.

- [x] A script dumps `tools.json` (name, annotations, facts) from the server's tool list; CI
      fails when the committed file is out of date.
- [x] A tag `vX.Y.Z` creates a GitHub release with `tools.json` attached and notes listing added,
      removed and re-annotated tools, generated from the diff with the previous tag.
- [x] The first tag is the first annotated version.

### S14-03 · Bochica reads the contract

Packages: agent (`mcp.ts`), eplan, desktop (scripts).

- [x] `McpManager` gives a server's `policy` the tool's annotations and `_meta` along with its
      name.
- [x] `eplanToolPolicy` derives approval and `changesProject` from the facts; the lists in
      `tool-policy.ts` become overrides with reasons; `eplanConfirmation` uses
      `projectArgument` where it is given.
- [x] `prepare-runtime --lock` writes `fixtures/eplan-mcp-tools.json` (name, annotations,
      facts) in place of the plain name list; `tool-policy.test.ts` reads it.
- [x] A test proves that, for the pinned version, every tool gets the same policy as before the
      switch, or lists the agreed differences.
- [x] Tests: no annotations → ask + backup; an override wins over the facts.

### S14-04 · Bump by tag

Packages: eplan (`ComponentsLock`), desktop (scripts), docs.

- [x] `components:bump eplan-mcp vX.Y.Z` records the tag next to the commit (optional `tag` in
      the lock schema, so the skills stay as they are) and prints the release notes link.
- [x] The bump prints which tools were added, removed or re-annotated, and warns in its own
      line for every tool that went from changing something to read-only.
- [x] `docs/releasing.md` describes the bump by tag.

### S14-05 · Release watch

Packages: CI.

- [x] `.github/workflows/components-watch.yml`, weekly and by hand: when eplan-mcp's latest
      release is newer than the pin, it opens an issue (one per version, never twice) with the
      release notes link and the bump command.

### S14-06 · Docs

- [x] CLAUDE.md: tool policy from annotations, the fixture, bump by tag, release watch. Backlog.

## Demo

`components:bump eplan-mcp` to the first annotated tag: the lock gains the tag, the fixture
diff shows annotations and facts, the bump prints no tool that became read-only, and
`bun run check` passes with the same policies as before. In Tasks mode, a read tool runs without
a card, a write tool asks and backs up the project, and deleting a project asks for the typed
name, as before. Comparing the fixture with a copy where one write tool is re-annotated as
read-only prints the warning. The release watch, run by hand, opens an
issue for a newer release and opens none a second time.

## Outcome

Done on 2026-11-06. eplan-mcp [v1.0.0](https://github.com/Canary-ECAD/eplan-mcp/releases/tag/v1.0.0)
(Canary-ECAD/eplan-mcp#77) is the first annotated release; Bochica pins it by tag.

- **Bump:** `components:bump eplan-mcp` without a ref took the latest release, recorded `v1.0.0`
  next to its commit and printed the release notes link; the contract showed 0 added, 0 removed,
  0 re-annotated against the build from the PR branch, and no tool became read-only. The fixture
  is now `eplan-mcp-tools.json` (217 tools, every one with its four hints and its facts).
- **Same policies:** `tool-policy.test.ts` checks every pinned tool against
  `eplan-tool-policies.json`, the pre-S14 classification with the one difference below; it passes,
  as does `bun run check` (654 tests).
- **In the app** (built app, Tasks mode, the bundled server connected to EPLAN 2026, a scripted
  model): `eplan_ping` ran without a card; `eplan_set_project_property` asked with
  "Allow for this session" (ask, with a backup after approval); `eplan_delete_device_list` asked
  for the project name typed, `Demo`, with no session allowance. Both cards were denied.
- **Warning:** a copy of the contract with `eplan_renumber_devices` re-annotated as read-only
  printed `WARNING: eplan_renumber_devices used to change something and is now read-only`.
- **Release watch:** run locally with the workflow's own script and `gh issue create` replaced by
  `echo`: with the pin at `v0.9.0` it would open "eplan-mcp v1.0.0 is out" with the notes and the
  bump command; with the real pin it does nothing. Run by hand on GitHub after the push, it
  logged `pinned v1.0.0, latest v1.0.0` and opened no issue.
- eplan-mcp's own CI (`check.yml`) ran green on the PR, and `release.yml` published v1.0.0 with
  `tools.json` attached and generated notes.

Differences from the plan, and why:

- **`eplan_run_project_action` now always asks** (was ask) and needs typed confirmation when its
  input deletes something: it runs any action against a project, so its fact is `runsCode`, like
  `eplan_action_run`. The one agreed policy difference.
- **One override:** `eplan_lock_unlock_all_objects` keeps `always` + backup although its facts
  give ask; upstream marks it deprecated and never verified, and it acts on every object at once.
- **Facts are flags in one table** (`TOOL_FLAGS` in `tool_annotations.py`, one line per tool:
  `read`, `project`, `code`, `eplan`, `destructive`, `idempotent`) rather than decorators on each
  action, since eplan-mcp registers its actions dynamically from `__all__`. `projectArgument` is
  read from each function's signature (`project_name`, `project_path` or `project`), so it can't
  drift. Extension modules may declare their own `TOOL_FLAGS`.
- **Typed confirmation keeps its lists** (`alwaysDestructive`, `runsAnything`) and only reads
  `projectArgument`: `destructiveHint` also covers closing EPLAN, which must ask but not need a
  typed name.
- **The policy reads only explicit hints:** `readOnlyHint` and `destructiveHint` must be set, and
  all three facts present, or the tool is unknown (ask + backup). MCP's defaults are not facts.
- **Discovery mode's meta-tools are annotated too** (`eplan_tools_call` carries the worst case);
  Bochica runs full mode, so they are not in its fixture.
- **eplan-mcp needs `mcp>=1.19.0`** (first SDK whose `FastMCP.tool` takes `meta`), and the
  watch issue's "never twice" relies on GitHub's issue search, checked only with no issue yet.
