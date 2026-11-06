# S15 — Parts database doctor

**Status:** active
**Goal:** a user asks "check my parts database" and gets a report graded by severity: parts
without an ERP number, a manufacturer, a description, a schematic macro, a picture or function
templates. Fixes come in batches; the database is backed up before the first write and checked
after every batch, in every permission mode, and nothing can destroy it. Where the Data Portal
has the part, Bochica suggests what is missing from there. The checks are a table that grows a
rule at a time. Canary-ECAD/bochica#1.

## Rules

The first set, chosen by the maintainer. A property is empty when it is left out of the export
or every language in it is blank.

| Rule                 | Property                                           | Fails when                                        | Severity |
| -------------------- | -------------------------------------------------- | ------------------------------------------------- | -------- |
| `part-number`        | 22001 `P_ARTICLE_PARTNR`                           | empty                                             | minor    |
| `erp-number`         | 22056 `P_ARTICLE_ERPNR`                            | empty, unless 22258 `P_ARTICLE_DISCONTINUED` is 1 | serious  |
| `manufacturer`       | 22007 `P_ARTICLE_MANUFACTURER`                     | empty                                             | serious  |
| `description`        | 22009 `P_ARTICLE_NOTE` (shown as "Description")    | empty                                             | serious  |
| `schematic-macro`    | 22145 `P_ARTICLE_GROUPSYMBOLMACRO`                 | empty                                             | medium   |
| `picture`            | 22045 `P_ARTICLE_PICTUREFILE`                      | empty                                             | medium   |
| `function-templates` | `functiontemplate` elements of the part's variants | none                                              | medium   |

The numbers and names come from the API documentation EPLAN installs
(`Eplan.EplApi.DataModelu.xml`). A description needs text in one language only; anything
Bochica writes into it is in the user's language (the app's). The Data Portal can suggest values
for every rule except the ERP number, which is the user's own.

## What exists

- **eplan-mcp v1.0.0** (pinned) reads and writes the parts database through EPLAN's own API, so
  the backend (Access, SQL Server…) doesn't matter: `eplan_partsmanagement_export` (`XPamExportXml`,
  `["*"]` for every part) and `_import` (modes 0 append, 1 update, 2 update + append, 3 replace
  - append), `eplan_parts_db_*`, `eplan_set_parts_data_source`, `eplan_restore_masterdata`.
- **The Data Portal web API** (`https://dataportal.eplan.com/api`) answers part checks, search
  and part details without a token.

## Decisions

- **Pre-made tools do the work, a skill tells the agent how.** `bochica__parts_report` and
  `bochica__parts_fix` compute and change; the model never reads thousands of parts and the same
  database always gives the same report. The `parts-doctor` skill explains the rules, the order
  to go through them, when a gap matters, how to propose batches and the language rule.
- **The skill ships with Bochica**, not from a pinned repository: it names Bochica's own tools and
  must change with them. `SkillService` gets a third source, skills bundled in the app.
- **Rules are data.** One table (`parts/rules.ts`: id, property, condition, exception,
  severity), so a new rule is a row and a test. User-defined rules come later.
- **Backend agnostic.** Everything goes through EPLAN's export and import.
- **Safety in every mode, as in Hermes:**
  - **Backup:** before the first write of a session, a full export to
    `userData\backups\parts\<time>.xml`. Not optional, not skipped by Auto.
  - **Smoke test after every batch:** export the changed parts again and the part count; if a
    value is not the new one, another field changed or the count moved, the series stops and the
    user is told, with the backup's name and how to restore it.
  - `parts_fix` asks (with "Allow for this session"), so a user in Auto can let batches run, at
    most 100 parts each, always with the backup and the smoke test.
  - **Typed confirmation** (layer 6, never skipped): replacing parts on import (mode 3),
    switching the parts database (`eplan_set_parts_data_source`), restoring master data.
  - **Hardline** (layer 1, blocked in every mode, no card can allow it): commands that drop,
    truncate or delete every row of a database (`sqlcmd`, `Invoke-Sqlcmd`, `osql` with
    `DROP DATABASE|TABLE`, `TRUNCATE`, `DELETE FROM` without `WHERE`); deleting a parts database
    file; EPLAN scripts that remove parts from the database. Hermes only asks for SQL `DROP`;
    Bochica blocks it, since a parts database is shared and has no undo.
- **The Data Portal only suggests.** Public endpoints, no token: for a flagged part found on the
  portal, its description (in the user's language when the portal has it) and manufacturer go
  into a `parts_fix` batch for the user to approve; for a missing macro, picture or function
  templates the report links the portal page. Never the ERP number.
- **Out of this sprint** (BACKLOG.md): importing from the portal (download list, PAT, the add-in);
  parts a project uses that the database lacks; the portal's lifecycle check; whether macro and
  picture files exist on disk; rules the user writes; a view of its own for the report.

## Tasks

### S15-01 · Spike: confirm the ground

- [x] `XPamExportXml`: its structure, and whether it carries every field the rules need.
- [x] How long the full export takes on a large database.
- [x] The Data Portal API's base URL and which endpoints need a token.
- [x] Whether the Remote Client's greeting still breaks stdio with v1.0.0.
- [x] How a project's parts are listed (for the backlog item).
- [ ] Whether an update-only import (mode 1) of one field leaves the rest of the part as it was,
      and the smallest import file that does it. Run on a dummy database during the demo, never
      on a real one.
- [ ] The EPLAN API calls that remove parts, for the script hardline.

#### Findings

Measured on P8 2025.0.3 with eplan-mcp v1.0.0 and the bundled runtime, driven by a script that
starts the server as Bochica does.

- **Export.** `eplan_partsmanagement_export` with `["*"]` wrote about 14,000 parts in
  21 s, 80 MB. `eplan_parts_db_count` counts variants, not parts. The file is
  `<partsmanagement>` with one `<part>` per part; its properties are attributes named as EPLAN's
  (`P_ARTICLE_PARTNR`, `P_ARTICLE_ERPNR`, `P_ARTICLE_NOTE`, `P_ARTICLE_GROUPSYMBOLMACRO`…, 159 in
  all). Children: `variant` (64 attributes) with its `functiontemplate` elements, `freeproperty`,
  `userproperty`, `accessoryposition` and a few more. What the rules must know:
  - an empty property is **left out**, not written as `""`;
  - multi-language text is `xx_XX@text;` repeated, `??_??@` for language-neutral;
  - `P_ARTICLE_DISCONTINUED` is `0` or `1`;
  - the manufacturer is its short name;
  - `P_ARTICLE_PICTUREFILE` and the macros are paths starting with a `$(…)` variable.
- **Project parts.** `eplan_export_parts_list` writes `<partsList>` with one `<part>` per use,
  part number in `P_ARTICLEREF_PARTNO`. A large macro project took 136 s. `eplan_check_parts`
  checks the database, not a project.
- **Greeting.** The Remote Client's `Server response: …` line still reaches stdout (one or two
  per session). The TypeScript SDK reports it to `onerror` and carries on; `McpManager` sets no
  `onerror`, so Bochica is not affected and needs no eplan-mcp change for it.
- **The web API** is OpenAPI 3.0 with JSON:API responses. **Without a token**: `GET|POST
  /partscheck` (the POST takes `text/plain`, one number per line, and returns
  `partscheckresult` with `partid`, `partnr`, `typenr`, `ordernr`, `part_version`,
  `upload_date`, or `partscheckmissingresult`), `GET /parts` (search) and `GET /parts/{id}`
  (`designation` and `description` per language, `lifecycle`, `identcode`, macro paths,
  relationships to manufacturer, picture, function templates, macros). **With a token**
  (`Authorization: Bearer PAT:{token}`, made in the ePulse profile): `/basketitems` and the
  commercial data CSV; no token gives `401 Missing JWT token`, a wrong one `401` with an empty
  body. There is no EDZ download: EPLAN part data only arrives through the add-in.

### S15-02 · Read and write the parts XML

Packages: eplan (`src/parts/`).

- [ ] `readPartsXml(path)` streams the export into typed parts (Zod): the rules' properties,
      multi-language values parsed, variants with their function template count.
- [ ] `writePartsUpdateXml(changes)` writes an import file with only the changed parts and
      fields; multi-language values keep their other languages.
- [ ] A made-up fixture export (`fixtures/parts-sample.xml`) with tests for both, including a
      round trip.

### S15-03 · Rules and report

Packages: eplan (`parts/rules.ts`, `parts/report.ts`), desktop (tool wiring).

- [ ] The rules table above, each rule with a sentence in en/es.
- [ ] Tool `bochica__parts_report` (Tasks mode, never asks; calls the export through
      `McpManager`): optional `rules`, product group and manufacturer filters; writes
      `parts-report-<date>.csv` (part, rule, severity) in the working folder and returns counts
      per rule and severity plus up to 10 examples each.
- [ ] A table test per rule on the fixture, the ERP exception included.

### S15-04 · Report card

Packages: desktop (renderer), shared.

- [ ] The tool's part renders as `PartsReportCard`: total parts, rules grouped by severity with
      their counts, expandable to examples, and "Open CSV". Rules with nothing to report are
      folded away.
- [ ] Activity sentences for both tools (`activity.*`), strings in en/es.

### S15-05 · Fixes with backup and smoke test

Packages: eplan, desktop (main, renderer).

- [ ] Tool `bochica__parts_fix`: a batch of `{ partNumber, field, value }`, at most 100 parts,
      only the rules' fields; asks, with "Allow for this session".
- [ ] Its approval card shows the batch as a table, current value next to the new one, read from
      the latest export.
- [ ] Before the first write of a session, in every mode, a full export to
      `userData\backups\parts\<time>.xml` (`PartsBackupGuard`); a failed backup stops the write.
- [ ] One mode 1 import per batch, then the smoke test: changed parts exported again and
      compared field by field, part count before and after. Any difference stops further batches
      in the session until the user says so, and the result names the backup.
- [ ] Tests: the card's table, one backup per session, a failed smoke test blocks the next batch,
      Auto still backs up and checks.

### S15-06 · Guardrails for the parts database

Packages: agent (`builtin/command-guard.ts`), eplan (`confirmation.ts`, `tool-policy.ts`), docs.

- [ ] Typed confirmation for `eplan_partsmanagement_import` with mode 3,
      `eplan_set_parts_data_source` and `eplan_restore_masterdata`, with tests.
- [ ] Hardline patterns in `assessCommand`: SQL `DROP DATABASE|TABLE`, `TRUNCATE`, `DELETE FROM`
      without `WHERE` through `sqlcmd`, `Invoke-Sqlcmd`, `osql` or `-Query`; deleting `.mdb` or
      `.accdb` parts database files. A row each in the table test and a sentence in en/es.
- [ ] `eplan_execute_custom_script` and `eplan_execute_script` are blocked when their code calls
      the parts removal API found in S15-01.
- [ ] `docs/design/guardrails.md` lists the parts database protections.

### S15-07 · Suggestions from the Data Portal

Packages: agent or desktop (main), eplan.

- [ ] `dataportal_check` (part numbers, in chunks) and `dataportal_part` (details): public
      endpoints, no token, never ask, read-only.
- [ ] For flagged parts found on the portal, the report offers description and manufacturer as
      `parts_fix` batches, the description in the user's language when the portal has it, else
      English; for macro, picture and function templates it gives the portal link.
- [ ] Errors (429, the portal down) become sentences that say what to do; nothing retries in a
      loop. Tests with a fake HTTP server.

### S15-08 · The parts-doctor skill

Packages: desktop (main `skills.ts`), a bundled skill folder.

- [ ] `SkillService` loads skills bundled with the app (`resources\skills` packaged), listed with
      the built-in ones and on by default.
- [ ] `parts-doctor/SKILL.md`: when to use it, the rules and severities, the order (report,
      serious first, batches the user approves, the portal for suggestions), what never to do
      (invent an ERP number, write descriptions in another language, skip the report before a
      fix), and how to read a failed smoke test.
- [ ] A test that the bundled skill loads and passes the injection scan.

### S15-09 · Docs

- [ ] CLAUDE.md (parts tools, bundled skills, parts guardrails), README and README.es (one
      feature line), BACKLOG.

## Demo

On a **dummy** parts database selected in EPLAN (made-up parts with planted gaps: no ERP on two,
one of them discontinued; no description; no schematic macro; no function templates), in Tasks
mode: "check my parts database" shows the report card grouped by severity, the discontinued part
not counted for ERP, and writes the CSV. "Fix the descriptions" shows one card with the table;
approving it backs the database up once, the smoke test passes and the report shows them fixed.
In Auto, a second batch runs without a card, still checked. A part found on the Data Portal gets
its description suggested in Spanish. Asking to "delete the parts database" is blocked, and so is
a `sqlcmd … DROP DATABASE`. The mode 1 round trip from S15-01 is checked here. `bun run check`
passes.

## Outcome

To be written when the sprint is done.
