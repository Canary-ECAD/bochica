# S15 — Parts database doctor

**Status:** done
**Goal:** a user asks "check my parts database" and gets a report graded by severity: parts
without an ERP number, a manufacturer, a description, a schematic macro, a picture or function
templates. Fixes come in batches; the database is backed up before the first write and checked
after every batch, in every permission mode, and nothing can destroy it. Bochica finds a flagged
part on the Data Portal by its part number, suggests its description, and brings its macro
through EPLAN's own Data Portal. The checks are a table that grows a rule at a time.
Canary-ECAD/bochica#1.

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
  `["*"]` for every part) and `_import` (modes 0 append, 1 update, 2 update and append, 3
  replace and append), `eplan_parts_db_*`, `eplan_set_parts_data_source`, `eplan_restore_masterdata`.
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
- **The Data Portal, by part number.** A flagged part is looked up by its 22001 part number
  (`partscheck`, public, no token); a hit whose manufacturer differs is not a match. Its
  description (in the user's language when the portal has it) and manufacturer go into a
  `parts_fix` batch for the user to approve. Never the ERP number.
- **Macros come through EPLAN's Data Portal.** Bochica queues the parts in the download list with
  the add-in's own action and EPLAN's sign-in (the tools of Canary-ECAD/eplan-mcp#75, brought
  into eplan-mcp and pinned by a new tag); the user downloads in EPLAN. The portal skips the part
  data of parts the database already has, so once the macro file is in the macros folder,
  `parts_fix` sets 22145 to it. Only supported surfaces: the documented API and the add-in,
  never the webview's internal calls, which carry the EPLAN licence.
- **The web API's download list is the fallback**, only if the add-in route fails on the dummy
  database: `POST /basketitems` with a PAT the user makes in their ePulse profile and pastes like
  an API key.
- **Out of this sprint** (BACKLOG.md): parts a project uses that the database lacks; the portal's
  lifecycle check; whether picture files exist on disk; rules the user writes; a view of its own
  for the report.

## Tasks

### S15-01 · Spike: confirm the ground

- [x] `XPamExportXml`: its structure, and whether it carries every field the rules need.
- [x] How long the full export takes on a large database.
- [x] The Data Portal API's base URL and which endpoints need a token.
- [x] Whether the Remote Client's greeting still breaks stdio with v1.0.0.
- [x] How a project's parts are listed (for the backlog item).
- [x] Whether an update-only import (mode 1) of one field leaves the rest of the part as it was,
      and the smallest import file that does it. Run on a dummy database during the demo, never
      on a real one.
- [x] The EPLAN API calls that remove parts, for the script hardline.
- [x] On the dummy database, during the demo: the add-in's actions exist on P8 2025; downloading a
      part the database already has puts its macro in the macros folder, and whether it changes
      the part. This decides whether S15-09 needs its fallback. Yes, yes, and no: see Outcome.

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

- [x] `readPartsXml(path)` streams the export into typed parts (Zod): the rules' properties,
      multi-language values parsed, variants with their function template count.
- [x] `writePartsUpdateXml(changes)` writes an import file with only the changed parts and
      fields; multi-language values keep their other languages.
- [x] A made-up fixture export (`fixtures/parts-sample.xml`) with tests for both, including a
      round trip.

### S15-03 · Rules and report

Packages: eplan (`parts/rules.ts`, `parts/report.ts`), desktop (tool wiring).

- [x] The rules table above, each rule with a sentence in en/es.
- [x] Tool `bochica__parts_report` (Tasks mode, never asks; calls the export through
      `McpManager`): optional `rules`, product group and manufacturer filters; writes
      `parts-report-<date>.csv` (part, rule, severity) in the working folder and returns counts
      per rule and severity plus up to 10 examples each.
- [x] A table test per rule on the fixture, the ERP exception included.

### S15-04 · Report card

Packages: desktop (renderer), shared.

- [x] The tool's part renders as `PartsReportCard`: total parts, rules grouped by severity with
      their counts, expandable to examples, and "Open CSV". Rules with nothing to report are
      folded away.
- [x] Activity sentences for both tools (`activity.*`), strings in en/es.

### S15-05 · Fixes with backup and smoke test

Packages: eplan, desktop (main, renderer).

- [x] Tool `bochica__parts_fix`: a batch of `{ partNumber, field, value }`, at most 100 parts,
      only the rules' fields; asks, with "Allow for this session".
- [x] Its approval card shows the batch as a table, current value next to the new one, read from
      the latest export.
- [x] Before the first write of a session, in every mode, a full export to
      `userData\backups\parts\<time>.xml` (`PartsBackupGuard`); a failed backup stops the write.
- [x] One mode 1 import per batch, then the smoke test: changed parts exported again and
      compared field by field, part count before and after. Any difference stops further batches
      in the session until the user says so, and the result names the backup.
- [x] Tests: the card's table, one backup per session, a failed smoke test blocks the next batch,
      Auto still backs up and checks.

### S15-06 · Guardrails for the parts database

Packages: agent (`builtin/command-guard.ts`), eplan (`confirmation.ts`, `tool-policy.ts`), docs.

- [x] Typed confirmation for `eplan_partsmanagement_import` with mode 3,
      `eplan_set_parts_data_source` and `eplan_restore_masterdata`, with tests.
- [x] Hardline patterns in `assessCommand`: SQL `DROP DATABASE|TABLE`, `TRUNCATE`, `DELETE FROM`
      without `WHERE` through `sqlcmd`, `Invoke-Sqlcmd`, `osql` or `-Query`; deleting `.mdb` or
      `.accdb` parts database files. A row each in the table test and a sentence in en/es.
- [x] `eplan_execute_custom_script` and `eplan_execute_script` are blocked when their code calls
      the parts removal API found in S15-01.
- [x] `docs/design/guardrails.md` lists the parts database protections.

### S15-07 · Look parts up on the Data Portal

Packages: agent or desktop (main), eplan.

- [x] `bochica__parts_lookup`: part numbers (22001), given by the user or taken from the report's
      flagged parts, in chunks through `POST /partscheck`, then `GET /parts/{id}` for each hit.
      Public endpoints, no token, never asks, read-only. Returns per part: found or not, the
      portal's id and page, description per language, manufacturer, schematic macro path,
      whether it has function templates and a picture. A hit whose manufacturer differs from the
      database's is reported as not a match.
- [x] Description and manufacturer become `parts_fix` batches, the description in the user's
      language when the portal has it, else English.
- [x] Errors (429, the portal down) become sentences that say what to do; nothing retries in a
      loop. Tests with a fake HTTP server.

### S15-08 · Data Portal tools in eplan-mcp

Repository: Canary-ECAD/eplan-mcp, then Bochica (`components:bump`).

- [x] `eplan_dataportal_add_to_download_list` and `eplan_dataportal_search_count` from
      Canary-ECAD/eplan-mcp#75 (the add-in's actions through a fixed script, `userAction` in the
      result), with their annotations and facts in `TOOL_FLAGS`, tests and `llm.md`. The PR's
      `Console.Out` change comes along: the greeting is harmless to Bochica but breaks stricter
      clients.
- [x] A new tag, pinned in Bochica; `eplan-tool-policies.json` reviewed for the two tools (search
      never asks; queueing asks, since it changes the user's online list).

### S15-09 · Bring the macro in

Packages: eplan, desktop.

- [x] For parts whose schematic macro is missing and the portal has one, the agent queues them
      with `eplan_dataportal_add_to_download_list`, tells the user what to click in EPLAN, and
      waits for them to say it's done.
- [x] Then the portal's macro path is looked for under the macros folder (`$(MD_MACROS)`
      resolved through EPLAN's settings); where the file is there, `parts_fix` proposes 22145
      with that path. Parts still without a file are listed.
- [x] ~~Fallback, only if S15-01 shows the add-in route fails: a Data Portal PAT in Settings
      (stored with `safeStorage` like an API key, Test with `GET /basketitems`, 401 explained) and
      queueing through `POST /basketitems`.~~ Not needed: the add-in route works on P8 2025.
      Kept in BACKLOG.md for clearing the download list.
- [x] Added from the demo: before queueing, `parts_lookup` checks that EPLAN can write to
      `$(MD_MACROS)`, `$(MD_IMG)` and `$(MD_XML)` (an empty file created and deleted) and says a
      download will fail when one is read-only.

### S15-10 · The parts-doctor skill

Packages: desktop (main `skills.ts`), a bundled skill folder.

- [x] `SkillService` loads skills bundled with the app (`resources\skills` packaged), listed with
      the built-in ones and on by default.
- [x] `parts-doctor/SKILL.md`: when to use it, the rules and severities, the order (report,
      serious first, batches the user approves, the portal by part number, macros through the
      download list), what never to do
      (invent an ERP number, write descriptions in another language, skip the report before a
      fix), and how to read a failed smoke test.
- [x] A test that the bundled skill loads and passes the injection scan.

### S15-11 · Docs

- [x] CLAUDE.md (parts tools, bundled skills, parts guardrails), README and README.es (one
      feature line), BACKLOG.

## Demo

On a **dummy** parts database selected in EPLAN: a few public catalog parts with planted gaps (no
ERP on two, one of them discontinued; no description; no schematic macro; no function
templates). In Tasks mode:

- "check my parts database" shows the report card grouped by severity, the discontinued part not
  counted for ERP, and writes the CSV;
- "fix the descriptions" shows one card with the table; approving it backs the database up once,
  the smoke test passes and the report shows them fixed; in Auto, a second batch runs without a
  card, still checked;
- "look up these part numbers on the Data Portal and find their macros and descriptions" finds
  them, suggests the descriptions in Spanish, queues the parts in EPLAN's download list, and after
  the user downloads, proposes the schematic macro paths;
- asking to "delete the parts database" is blocked, and so is a `sqlcmd … DROP DATABASE`.

The open S15-01 checks are run here. `bun run check` passes.

## Outcome

Done on 2026-11-06, on P8 2025.0.3 with eplan-mcp v1.1.0 (Canary-ECAD/eplan-mcp#78), against a
dummy parts database (EPLAN's `.alk` format) of about 75 parts.

- **Report:** `parts_report` read the dummy database and, in the spike, a database of about
  14,000 parts in about a second after a 21 s export, with the same counts as an independent
  script. In the app (built, Tasks mode, a scripted model) the card showed the rules by severity
  and the CSV opened; discontinued parts didn't count for the ERP rule.
- **Fixes:** a `parts_fix` batch showed its table (current value next to the new one), backed the
  database up once (`userData\backups\parts`) and passed its smoke test. A second batch in Auto
  ran without a card ("Permitido por el modo Auto"), still checked, with the same backup. The
  mode 1 import with whole parts changed only the given fields: variants, function templates and
  the entry count stayed.
- **Data Portal:** `parts_lookup` found Weidmüller parts by part number with their Spanish
  description and macro path; some manufacturers' numbers aren't found as stored (Rittal's dots,
  Lapp). The full loop worked on a part created empty: queued with the add-in's action, downloaded
  by the user in EPLAN, its macro arrived in `$(MD_MACROS)`, `parts_lookup` then proposed
  `$(MD_MACROS)\Weidmueller\1608740000.ema`, and one batch filled description, manufacturer and
  schematic macro. The ERP number stayed empty, as it must.
- **Guardrails:** asking to delete the parts database, by `Remove-Item` on the `.alk` file or by
  `sqlcmd … DROP DATABASE`, was blocked in Auto mode, and the file stayed.
- `bun run check` passes (715 tests); eplan-mcp's suite passes (1417 tests).

What the demo taught, and what changed because of it:

- **The portal skips the part data of a part the database has**, confirmed: the download brought
  the macro file and picture, not the description, manufacturer, macro path or function
  templates. Filling 22145 from the file on disk is the way; function templates and pictures for
  existing parts stay in BACKLOG.md.
- **A download writes into the master data folders.** With `$(MD_IMG)` on a read-only share it
  failed inside EPLAN ("access denied"), after staging everything in `%TEMP%\EDPADL\<id>` with
  `$(MD_MACROS)`, `$(MD_IMG)` and `$(MD_XML)` subfolders. `parts_lookup` now checks those folders
  first.
- **P8 2025 has `EDPCloudAddPartsToBasketAction` but not `EDPCloudGetSearchCountAction`** (2026
  has both); Bochica searches through the public API anyway. On 2025 queueing also opens the Data
  Portal window and the call doesn't come back while it is open: the part was queued but
  eplan-mcp closed the connection after two minutes. The skill tells the agent to ask the user
  to look at the window instead of queueing again; a fix in eplan-mcp is in BACKLOG.md.
- **The Remote Client's greeting** reached stdout; harmless to Bochica, fixed in eplan-mcp v1.1.0
  (0 transport errors since).
- **EPLAN's own parts database file is `.alk`**, added to the files a command may never delete.
- A first dummy database without EPLAN's `tblOption` table made the download fail; one EPLAN
  creates itself works.
- Only the Data Portal's documented API and the add-in are used. The webview's internal calls
  (`fileprovider`, `part_import_strategy_event`) carry the EPLAN licence and are not touched.
