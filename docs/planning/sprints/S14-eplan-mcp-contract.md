# S14 — eplan-mcp contract

**Status:** planned
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

- [ ] Every tool declares the four MCP annotations and the `canary-ecad/eplan` facts above,
      seeded from Bochica's `tool-policy.ts`. Check that the pinned Python SDK (`mcp<2`) can set
      `_meta` on a tool; if it can't, say so in this file and find another place for the facts
      before going on.
- [ ] A test in eplan-mcp fails when a tool has no annotations or no facts.
- [ ] `llm.md` and the README document the annotations and the `_meta` key for other clients.

### S14-02 · Tagged releases of eplan-mcp

Repository: Canary-ECAD/eplan-mcp.

- [ ] A script dumps `tools.json` (name, annotations, facts) from the server's tool list; CI
      fails when the committed file is out of date.
- [ ] A tag `vX.Y.Z` creates a GitHub release with `tools.json` attached and notes listing added,
      removed and re-annotated tools, generated from the diff with the previous tag.
- [ ] The first tag is the first annotated version.

### S14-03 · Bochica reads the contract

Packages: agent (`mcp.ts`), eplan, desktop (scripts).

- [ ] `McpManager` gives a server's `policy` the tool's annotations and `_meta` along with its
      name.
- [ ] `eplanToolPolicy` derives approval and `changesProject` from the facts; the lists in
      `tool-policy.ts` become overrides with reasons; `eplanConfirmation` uses
      `projectArgument` where it is given.
- [ ] `prepare-runtime --lock` writes `fixtures/eplan-mcp-tools.json` (name, annotations,
      facts) in place of the plain name list; `tool-policy.test.ts` reads it.
- [ ] A test proves that, for the pinned version, every tool gets the same policy as before the
      switch, or lists the agreed differences.
- [ ] Tests: no annotations → ask + backup; an override wins over the facts.

### S14-04 · Bump by tag

Packages: eplan (`ComponentsLock`), desktop (scripts), docs.

- [ ] `components:bump eplan-mcp vX.Y.Z` records the tag next to the commit (optional `tag` in
      the lock schema, so the skills stay as they are) and prints the release notes link.
- [ ] The bump prints which tools were added, removed or re-annotated, and warns in its own
      line for every tool that went from changing something to read-only.
- [ ] `docs/releasing.md` describes the bump by tag.

### S14-05 · Release watch

Packages: CI.

- [ ] `.github/workflows/components-watch.yml`, weekly and by hand: when eplan-mcp's latest
      release is newer than the pin, it opens an issue (one per version, never twice) with the
      release notes link and the bump command.

### S14-06 · Docs

- [ ] CLAUDE.md: tool policy from annotations, the fixture, bump by tag, release watch. Backlog.

## Demo

`components:bump eplan-mcp` to the first annotated tag: the lock gains the tag, the fixture
diff shows annotations and facts, the bump prints no tool that became read-only, and
`bun run check` passes with the same policies as before. In Tasks mode, a read tool runs without
a card, a write tool asks and backs up the project, and deleting a project asks for the typed
name, as before. Comparing the fixture with a copy where one write tool is re-annotated as
read-only prints the warning. The release watch, run by hand, opens an
issue for a newer release and opens none a second time.
