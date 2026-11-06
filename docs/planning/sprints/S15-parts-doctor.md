# S15 — Parts database doctor

**Status:** active
**Goal:** a user asks "check my parts database" and gets a report they can read: what is
missing, duplicated or inconsistent, and which parts their project uses that the database lacks.
Fixes come in batches the user approves one card at a time, with the database backed up before
the first write. Missing parts are found on the EPLAN Data Portal, queued for download and, after
one click in EPLAN, imported. Canary-ECAD/bochica#1.

## What exists

- **eplan-mcp v1.0.0** (pinned) reads and writes the parts database through EPLAN's own API, so
  the backend (Access, SQL Server…) doesn't matter to Bochica: `eplan_parts_db_query`, `_count`,
  `_get_part`, `_list_product_groups`, `_create`, `_update` (one property per call),
  `eplan_partsmanagement_export` (`XPamExportXml` or EDZ, `["*"]` for every part) and
  `_import` (modes 0 append, 1 update, 2 update + append, 3 replace + append),
  `eplan_check_parts`, `eplan_export_parts_list`, `eplan_backup_masterdata`. It has no Data
  Portal tools.
- **The Data Portal web API** (`dataportal.eplan.com/api/doc`), read for this plan:
  - Auth: `Authorization: Bearer PAT:{token}`. The user makes the Personal Access Token in their
    ePulse profile, for the Data Portal, with an expiry date. An ePulse Community account
    can't; the account must belong to an organisation.
  - `POST /partscheck` (part, type or order numbers, one per line; `exact`,
    `allow_multiple_results`) says which exist on the portal. `GET /parts` searches (text,
    fuzziness, manufacturer, EPLAN or eCl@ss catalog, features; paged). `GET /parts/{id}` gives
    details; `/manufacturers`, `/suggestions/*` help the search.
  - `GET|POST|PATCH|DELETE /basketitems` manage the user's download list.
  - Downloads: commercial data CSV (per part, list or download list), part number CSV, DXF and
    E3D. **No EDZ or part XML**: the EPLAN part data itself only arrives through the Data Portal
    add-in inside EPLAN.
- **The add-in route**, measured on P8 2026 in a closed eplan-mcp PR (Canary-ECAD/eplan-mcp#75):
  `EDPCloudGetSearchCountAction` and `EDPCloudAddPartsToBasketAction` (`PARTNR<i>` and
  `PARTID<i>` both required, indexes from 1, an already listed part returns `executed=false`).
  The download is a modal dialog the user clicks. The Data Portal skips parts whose number the
  database already has. The same PR redirected .NET `Console.Out` to stderr because the Remote
  Client's greeting broke the stdio channel; v1.0.0 doesn't have that change.

## Decisions

- **The report is computed, not guessed.** Bochica exports the whole database to XML in the
  session's working folder and checks it in TypeScript. The model gets counts and examples and
  explains them; it never reads thousands of parts.
- **Backend agnostic.** Everything goes through EPLAN's export and import, so Access, SQL
  Server or any other source EPLAN is set to work the same.
- **Fixes go through one Bochica tool, not the model calling import.** `parts_fix` takes a batch
  of changes, shows them as a table on its card (part, field, old → new), and applies them with
  one update-only import (mode 1). It always asks, with no "Allow for this session": it changes
  EPLAN's master data (`changesEplan`). The first write of a session is preceded by a full
  export kept under `userData\backups\parts`, which is the way back.
- **The Data Portal web API lives in Bochica's main process**, not in eplan-mcp (this changes
  what BACKLOG.md said). It doesn't need EPLAN, and the PAT then stays in the credential store
  and never reaches a child process.
- **The download stays in EPLAN.** Bochica queues parts through the API; the user downloads them
  with the add-in, which imports them. If the spike shows the API's download list is not the one
  the add-in shows, the queue moves to the add-in actions of Canary-ECAD/eplan-mcp#75, ported
  to eplan-mcp and pinned by a new tag.
- **What goes to the portal.** Only part numbers and search text are sent, to the service the
  user gave a token for. Reading the portal doesn't ask; adding to the download list asks,
  because it changes the user's list online.
- **No separate skill yet.** The tools return what to do next and the Tasks prompt gets a short
  section on the workflow. A built-in skill comes only if the demo shows the model getting lost.
- **Out of this sprint:** macros, pictures, DXF and E3D downloads; configurators; scheduling the
  report; a view of its own for the report (it is a card in the chat plus a CSV).

## Tasks

### S15-01 · Spike: confirm the ground

Write the answers in this file before S15-02.

- [x] `XPamExportXml`: its structure, and whether it carries every field the report needs.
- [ ] Whether an update-only import (mode 1) of one changed field leaves the rest of the part as
      it was. Needs a made-up database selected in EPLAN.
- [x] How long the full export takes on a large database.
- [x] The API's base URL, what a wrong PAT returns, which endpoints need one.
- [ ] One authenticated call with a real PAT; whether the API states the token's expiry.
- [ ] Whether parts added through `POST /basketitems` show up in the add-in's download list in
      EPLAN with the same account, and whether the add-in's actions exist on P8 2025 too. This
      decides S15-06 and S15-08.
- [x] Whether the Remote Client's greeting still breaks stdio with v1.0.0 and the bundled
      runtime.
- [x] How a project's parts are listed best for "used but not in the database".

#### Findings

Measured on P8 2025.0.3 with eplan-mcp v1.0.0 and the bundled runtime, driven by a script that
starts the server as Bochica does.

- **Export.** `eplan_partsmanagement_export` with `["*"]` wrote 13,739 parts (13,810 variants)
  in 21 s, 80 MB. `eplan_parts_db_count` counts variants, not parts. The file is
  `<partsmanagement>` with one `<part>` per part; its properties are attributes named as EPLAN's
  (`P_ARTICLE_PARTNR`, `P_ARTICLE_DESCR1`, `P_ARTICLE_MANUFACTURER`, `P_ARTICLE_ORDERNR`,
  `P_ARTICLE_TYPENR`, `P_ARTICLE_ERPNR`, `P_ARTICLE_PICTUREFILE`, `P_ARTICLE_MACRO`,
  `P_ARTICLE_GROUPSYMBOLMACRO`, `P_ARTICLE_QUANTITYUNIT`, product groups…, 159 in all).
  Children: `variant` (64 attributes), `functiontemplate`, `freeproperty`, `userproperty`,
  `accessoryposition` and a few more. Things the report must know:
  - an empty property is **left out**, not written as `""`;
  - multi-language text is `xx_XX@text;` repeated (`??_??@` for language-neutral);
  - the manufacturer is its short name;
  - every part has a `P_ARTICLE_PICTUREFILE`, a path starting with a `$(…)` variable, so "no
    picture" means the file is missing once the variable is resolved, not an empty field;
  - few parts have `P_ARTICLE_MACRO`; `P_ARTICLE_GROUPSYMBOLMACRO` is the common one. Most parts
    have neither, so "no macro" is only worth reporting for product groups that are placed.
- **Project parts.** `eplan_export_parts_list` writes `<partsList>` with one `<part>` per use,
  part number in `P_ARTICLEREF_PARTNO`. A large macro project took 136 s, so the report says it is
  reading the project and runs it only when asked. `eplan_check_parts` checks the database, not a
  project.
- **Greeting.** The Remote Client's `Server response: …` line still reaches stdout (one or two
  per session). The TypeScript SDK reports it to `onerror` and carries on; `McpManager` sets no
  `onerror`, so Bochica is not affected and needs no eplan-mcp change for it.
- **The web API** is `https://dataportal.eplan.com/api`, OpenAPI 3.0, JSON:API responses.
  **Without a token** it answers `GET|POST /partscheck` (the POST takes `text/plain`, one number
  per line, and returns `partscheckresult` with `partid`, `partnr`, `typenr`, `ordernr`,
  `part_version`, `upload_date`, or `partscheckmissingresult`), `GET /parts` (search, 2.4 million
  parts) and `GET /parts/{id}`, whose attributes include `designation` and `description` per
  language, `lifecycle` (`Active`…), `identcode`, macro paths and relationships to manufacturer,
  groups, picture and macros. **A token is needed** for `/basketitems` and the commercial data
  CSV: no token gives `401 Missing JWT token`, a wrong PAT `401` with an empty body.
  `/authorization_usage` answers 200 with or without a token, so Test uses `GET /basketitems`.

What this changes:

- The portal check, the lifecycle check and filling descriptions need no PAT: they use the
  public endpoints. S15-07's read tools work for everyone and S15-09 reads `/parts/{id}`
  instead of the commercial CSV.
- The PAT is only for the download list. If the add-in's actions work on 2025 too, the add-in
  route needs no PAT at all and S15-06 becomes optional.
- A new check: parts whose portal lifecycle is not `Active`.

### S15-02 · Read and write the parts XML

Packages: eplan (`src/parts/`).

- [ ] `readPartsXml(path)` parses the export into typed parts (Zod), streaming, so 20,000 parts
      don't need the whole file as one string.
- [ ] `writePartsUpdateXml(changes)` writes an import file with only the changed parts and
      fields.
- [ ] A made-up fixture export (`fixtures/parts-sample.xml`) with tests for both, including a
      round trip.

### S15-03 · Health report

Packages: eplan (`parts/report.ts`), desktop (tool wiring).

- [ ] Checks, each with a stable id and a sentence in en/es: no description; no manufacturer;
      no order number; no type number; no macro; no picture; the same order number or type
      number on more than one part; manufacturer names that differ only in case, spaces or
      punctuation; inconsistent units; parts the open project uses that the database lacks.
- [ ] Tool `bochica__parts_report` (Tasks mode, never asks; it calls the export through
      `McpManager`): exports, runs the checks, writes `parts-report-<date>.csv` in the working
      folder and returns counts per check plus up to 10 examples each.
- [ ] Table tests for every check on the fixture.

### S15-04 · Report card

Packages: desktop (renderer), shared.

- [ ] The tool's part renders as `PartsReportCard`: total parts, one row per check with its
      count, expandable to its examples, and "Open CSV". Checks with nothing to report are
      folded away.
- [ ] Activity sentence for the report and the fix tool (`activity.*`), strings in en/es.

### S15-05 · Fixes in approved batches

Packages: eplan, desktop (main, renderer).

- [ ] Tool `bochica__parts_fix`: a batch of `{ partNumber, field, value }` (at most 100), policy
      `always`, no session allowance.
- [ ] Its approval card shows the batch as a table with the current value next to the new one,
      read from the latest export, and says how many parts change.
- [ ] Before the first write of a session, a full export to `userData\backups\parts\<time>.xml`
      (a `PartsBackupGuard` like `BackupGuard`); the result names it.
- [ ] Applies the batch with one mode 1 import, exports the changed parts again and reports per
      part whether the value is now the new one.
- [ ] Tests: the card's table, the backup happens once per session, a part the import didn't
      change is reported as not fixed.

### S15-06 · Data Portal token

Packages: shared (IPC), desktop (main `credentials.ts`, renderer Settings).

- [ ] Settings gets a Data Portal section: paste a PAT, label, masked preview, **Test**, remove;
      a line on how to make one in the ePulse profile. Stored with `safeStorage` like the API
      keys; the renderer never sees it in clear text.
- [ ] Test makes one cheap authenticated call and turns 401/403 into "the token is wrong or has
      expired, make a new one in your ePulse profile".
- [ ] The PAT goes through `redactSecrets` and never into a prompt, a log or a child process.

### S15-07 · Data Portal tools

Packages: agent or desktop (main), server `dataportal`.

- [ ] `dataportal_check` (part, type or order numbers, in chunks the API accepts),
      `dataportal_search`, `dataportal_part`: never ask, read-only, available when a PAT is set.
- [ ] `dataportal_add_to_download_list`: asks, names the parts on its card.
- [ ] `dataportal_commercial_data`: saves the CSV for a list of parts in the working folder.
- [ ] Errors (401, 429, the portal down) become sentences that say what to do; nothing retries
      in a loop. Tests with a fake HTTP server.

### S15-08 · Download and import in EPLAN

Packages: eplan, desktop. Depends on S15-01's download list answer.

- [ ] After queueing, the agent tells the user what to click in EPLAN to download the list, and
      waits for them to say it's done; then `parts_report` on those part numbers shows which
      arrived.
- [ ] If the API's list is not the add-in's: the add-in actions from Canary-ECAD/eplan-mcp#75
      go into eplan-mcp with their facts, a new tag is pinned with `components:bump`, and
      queueing uses them instead.

### S15-09 · Fill gaps from the portal

Packages: eplan.

- [ ] The commercial data CSV is mapped to `ARTICLE_*` fields (description, manufacturer, order
      and type number) and offered as `parts_fix` batches for the parts the report flagged.
- [ ] A test on a made-up CSV.

### S15-10 · Prompt and docs

- [ ] A Tasks-mode prompt section: report first, fixes in batches the user approves, portal for
      what's missing, download in EPLAN.
- [ ] CLAUDE.md (parts tools, Data Portal token and tools), README and README.es (one feature
      line), BACKLOG.

## Demo

A made-up parts database of about 30 parts with planted problems (missing descriptions, a
duplicated order number, one manufacturer spelt two ways) and a made-up project that uses three
public catalog parts the database lacks. In Tasks mode, "check my parts database" shows the
report card with those counts and writes the CSV. "Fix the descriptions" shows one card with the
table; approving it backs the database up once and the report then shows them fixed. "Find the
missing ones on the Data Portal" finds them, a card asks to add them to the download list, the
user downloads them in EPLAN, and the report shows them in the database. A wrong PAT in Settings
fails Test with the ePulse sentence. `bun run check` passes.

## Outcome

To be written when the sprint is done.
