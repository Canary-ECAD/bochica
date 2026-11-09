# S16 — Macros by product number

**Status:** active
**Goal:** a user brings a macro project for a product family: its macros are drawn, but nothing
says which ones a given product needs. With the agent, and approving each step, they write the
rules: how the product number reads (segments and their values) and which macro, variant and
value set each value takes. Bochica checks the macro project against the rules and fixes what
is missing in approved batches. Then, for a concrete product number, it builds the schematic in
a project, the same way every time, and checks it. Canary-ECAD/bochica#2.

## The pieces

| Piece          | What it is                                                                                        | Who does it                                   |
| -------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Product number | Segments (`MS-400-7K5-B`: family, voltage, power, option), each with its values and their meaning | The user, with the agent; a rules file        |
| Rules          | For each value (or a combination of values), the macro, its variant and the value set it takes    | The user, with the agent; the same rules file |
| Linter         | The macro project against the rules: what is missing, unused or contradictory, graded by severity | A Bochica tool; the same report each time     |
| Fixes          | Gaps the linter found in the macro project, in batches the user approves, after a backup          | A Bochica tool; the agent proposes            |
| Generation     | One product number → a plan (macros, variants, value sets, properties) → the pages in a project   | A Bochica tool; deterministic                 |

## Example

A made-up family, used in tests and the demo (this is a public repository):

```text
MS-400-7K5-B
│  │   │   └─ option:  B = brake, N = none
│  │   └───── power:   2K2, 4K0, 7K5 (kW)
│  └───────── voltage: 230, 400 (V)
└──────────── family:  MS (motor starter)
```

Its "dirty" macro project has a window macro per power size, the voltage as value sets on
placeholder objects, and the brake as a macro variant, and nothing that ties them to the code.

## What exists

- **eplan-mcp v1.3.0** (pinned): `eplan_generate_macros`, `eplan_prepare_macros`,
  `eplan_update_macros`, `eplan_live_insert_macro` (a window macro by insertion point, devices
  tagged), `eplan_live_batch` (op `macro`), `eplan_set_property` / `eplan_set_project_property`,
  `eplan_live_read_page`, `eplan_live_verify_page`, `eplan_live_check_page`, `eplan_check_project`,
  and `eplan_api_types` / `eplan_api_describe` to look the API up. Nothing yet reads macro boxes,
  placeholder objects or value sets, nor inserts a macro with a chosen variant and value set.
- **S15's pattern:** rules as a table, a report card, fixes in batches with a backup and a check
  after each one, a bundled skill that drives the tools.
- **Project backup** (`BackupGuard`) before the first change of a session, and the pinned target
  project (`eplan_live_set_target_project`).

## Decisions

- **The rules are data the user owns.** One JSON file per family in the working folder
  (`<family>.product.json`), validated with a Zod schema in `@bochica/eplan`: the code (segments by
  position or separator, values with a label per language), the rules (a `when` of segment values,
  all of which must match, and what it takes: macro, variant, value set, page or order), and the
  project properties the product number and its options go to. The agent writes it with the file
  tools; cards show it as tables, so nobody has to read JSON.
- **Pre-made tools compute, the skill guides,** as in S15. The model never places macros one by
  one: the generator turns the rules into a plan, so the same product number always gives the same
  schematic. The `product-macros` skill ships with the app.
- **Human in the loop at every step:** the code, the rules, each batch of fixes and each
  generation are shown and approved. The linter runs before every fix and every generation.
- **Two projects, two roles.** The macro project is the source: only the fixes change it, after a
  backup. Generation writes only into the project the user names, adds pages and never deletes,
  after its own backup.
- **No writes to the master data folders.** Bochica never writes into `$(MD_MACROS)` or the other
  master data folders, which are often shared: if generating macro files is needed (S16-01 says),
  they go to a folder the user picks.
- **Sheet size and plot frames are the user's.** The generator uses the pages as the macros bring
  them; it does not pick formats.
- **Out of this sprint** (BACKLOG.md): EEC Pro; rules imported from a spreadsheet; the whole
  project as code with import from EPDZ, plan and apply (Canary-ECAD/bochica#4); parts the rules
  name that the database lacks (S15's doctor covers the database side).

## Tasks

### S16-01 · Spike: what EPLAN lets us read and do

Read-only on the API; writes only on a dummy macro project and a scratch project.

- [ ] The API types for macro boxes, placeholder objects, value sets and window macros
      (`eplan_api_types`, `eplan_api_describe`): what can be read and set, and how.
- [ ] Reading a macro project in one call: every macro box (name, variant, representation type,
      description, page) and every placeholder (its value sets and variables). How long it takes.
- [ ] Inserting a window macro with a chosen variant, then applying a value set to its
      placeholder, from a script on the scratch project.
- [ ] Where `eplan_generate_macros` writes, and whether generation needs `.ema` files at all or
      can insert from the macro project.
- [ ] Which of these need new tools in eplan-mcp (S16-02), and their facts.

### S16-02 · Macro tools in eplan-mcp

Repository: Canary-ECAD/eplan-mcp, then Bochica (`components:bump`).

- [ ] The tools S16-01 finds missing (for example reading a macro project's boxes and placeholders,
      inserting a macro with a variant and a value set, applying a value set), with annotations and
      facts in `TOOL_FLAGS`, tests and `llm.md`.
- [ ] A new tag, pinned in Bochica; `eplan-tool-policies.json` reviewed for the new tools.

### S16-03 · Rules file and decoder

Packages: eplan (`src/product/`), shared.

- [ ] Zod schema for `<family>.product.json`; errors name the field and say what to change.
- [ ] `decodeProductNumber(rules, number)`: the options, or which segment is wrong and the values
      it allows.
- [ ] `planFor(rules, number)`: the ordered list of macros, variants, value sets and properties.
- [ ] Table tests on the example family: every valid number, wrong segments, overlapping rules,
      the same number giving the same plan.

### S16-04 · Read the macro project

Packages: eplan, desktop (main).

- [ ] `bochica__macro_project_read` (Tasks mode, read-only, never asks): the macro project's macros,
      variants, value sets and parts, written as `macros-<date>.json` in the working folder, with
      counts and examples for the model.

### S16-05 · Linter and its card

Packages: eplan, desktop (main, renderer), shared.

- [ ] `bochica__product_check`: the rules file against the macro project. Rules as a table, one row
      each, with a severity: a rule names a macro, variant or value set that doesn't exist (serious);
      a segment value no rule covers (serious); two rules that both match a number and disagree
      (serious); a macro no rule uses (minor); a placeholder value set with a variable left empty
      (medium); a macro box without a description (minor).
- [ ] The result renders as a card grouped by severity, like `PartsReportCard`; activity sentences
      and strings in en/es.
- [ ] A table test per check.

### S16-06 · Fixes in the macro project

Packages: eplan, desktop (main). What it can change depends on S16-01.

- [ ] `bochica__macro_fix`: batches the user approves (description, variant, value set entries),
      with the current value next to the new one in the card; the macro project backed up before
      the session's first batch; read back after each batch, and a difference stops the session's
      batches.

### S16-07 · Generate a product

Packages: eplan, desktop (main, renderer).

- [ ] `bochica__product_generate`: a product number and a target project. The linter runs first and
      a serious finding stops it. The approval card shows the plan as a table. Then the backup, the
      macros inserted with their variants and value sets, the project properties set, and the page
      check and `eplan_live_verify_page` against the plan; the result lists any difference.
- [ ] Refuses the macro project as the target; adds pages, never removes.
- [ ] Tests with a fake server: plan order, a failed check reported, the backup taken once.

### S16-08 · Guardrails

Packages: eplan (`tool-policy.ts`, `confirmation.ts`), docs.

- [ ] Policies for the new tools from their facts; `eplanOverrides` only with a reason.
- [ ] No Bochica tool writes into the master data folders; a test for it.
- [ ] `docs/design/guardrails.md` lists the macro project and generation protections.

### S16-09 · The product-macros skill

Packages: a bundled skill folder.

- [ ] `product-macros/SKILL.md`: when to use it; the order (read the macro project, agree the code
      with the user, propose the rules, check, fix in batches, generate a sample number, check it);
      how to ask about segments a non-technical user understands; what never to do (place macros by
      hand instead of generating, change the macro project without a batch, pick sheet sizes).
- [ ] The test that bundled skills load and pass the injection scan covers it.

### S16-10 · Docs

- [ ] CLAUDE.md (product tools, the rules file), README and README.es (one feature line),
      BACKLOG.

## Demo

On a **dummy** macro project for the example family, made for the demo, and a scratch target
project. In Tasks mode:

- "here is my macro project for the motor starters" reads it and lists its macros, variants and
  value sets;
- the agent asks how the product number reads, writes the rules file with the user, and the check
  card shows what the macro project lacks;
- one batch of fixes is approved, the macro project is backed up once and the check comes back
  clean;
- "build MS-400-7K5-B" shows the plan, generates the pages, and the page check and the verify pass;
  building it again gives the same pages;
- a wrong number (`MS-500-7K5-B`) is refused with the voltages it allows.

`bun run check` passes.
