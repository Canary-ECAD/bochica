# Guardrails

How Bochica keeps an AI agent from doing damage on a Windows machine with EPLAN on it. Modeled
on Hermes Agent's layered security model (see its `website/docs/user-guide/security.md`;
check the current version before copying details) and adapted to Windows, PowerShell, EPLAN and
users who cannot judge a shell command themselves.

Guiding rule: **the user approves outcomes, not commands.** Every prompt explains in plain
language what will happen ("This will delete the folder _Old projects_ and everything in it"),
with the raw command available behind a "Details" toggle.

## Layers

Checks run in this order. A layer that blocks stops the call; the agent gets an explanatory
error and is told not to retry or rephrase.

| #   | Layer                                       | Overridable?                                       | Sprint                 |
| --- | ------------------------------------------- | -------------------------------------------------- | ---------------------- |
| 1   | Input sanitization (paths, working dirs)    | No                                                 | S7                     |
| 2   | Hardline blocklist                          | No, not even in YOLO mode                          | S7                     |
| 3   | User deny rules                             | No (user edits the list in Settings)               | S10                    |
| 4   | Protected paths for file tools              | No                                                 | S7                     |
| 5   | Dangerous-action approval                   | Yes: once / session / always / deny; YOLO skips it | S3 (card) · S7 (rules) |
| 6   | EPLAN project safety                        | Approval + automatic backup                        | S4                     |
| 7   | Secret isolation (env filtering, redaction) | No                                                 | S1 (redaction) · S4/S7 |
| 8   | Context-file injection scan                 | No (file is not loaded)                            | S7                     |
| 9   | Network policy (SSRF guard for URL tools)   | Settings toggle for private URLs                   | when web tools land    |

### 1. Input sanitization

- Reject Windows NT/device-namespace paths (`\??\…`, `\\.\…`, `\\?\UNC\…`, `\\?\GLOBALROOT…`)
  for reads and writes, on the raw string, before resolving them: resolving can trigger SMB
  authentication and leak the user's NTLM hash.
- Working directories passed to the terminal tool must be absolute, existing, and not a device
  path.
- Commands whose quoting cannot be parsed fail closed ("malformed command").

### 2. Hardline blocklist (always-on floor)

Refused regardless of approvals, "always allow" or YOLO mode. Windows-first list:

- Formatting or wiping disks: `Format-Volume`, `Clear-Disk`, `diskpart`, `format X:`,
  `cipher /w`.
- Recursive deletes of a drive root, `%SystemRoot%`, `%ProgramFiles%`, or the user profile root:
  `Remove-Item -Recurse` / `rd /s` / `del /s` on those targets.
- Boot and recovery tampering: `bcdedit`, `vssadmin delete shadows`, `wbadmin delete`.
- Download-and-execute: `iwr … | iex`, `Invoke-Expression` over downloaded content,
  `curl … | powershell`, `Start-Process` on a just-downloaded file.
- Killing Bochica itself (`Stop-Process -Name Bochica`, `taskkill /IM Bochica.exe`).

### 3. User deny rules

A list of glob patterns in Settings ("Never allow…"), matched case-insensitively against the
normalized command and each sub-command, also with the command's alias expanded (`rm` →
`Remove-Item`). Lets advanced users run YOLO with exceptions. Built in S10: `deniedBy`, checked in
the PowerShell tool's assessment, so a match is blocked before any approval, in every mode.

### 4. Protected paths (file tools)

Writes are always refused for: `%USERPROFILE%\.ssh\`, `.aws`, `.kube`, `.netrc`, Bochica's own
credential store and config, browser profiles. Project `.env*` files are **read-denied**
(the agent may write them but never read values back).

Note, as Hermes does: these apply to the file tools. The terminal runs as the same Windows user
and could reach the same files; layers 2, 3 and 5 are what cover the terminal.

### 5. Dangerous-action approval

A pattern list flags commands for approval, e.g. recursive deletes, `-Force` deletes,
`Stop-Process`/`taskkill` by name, registry writes (`reg add/delete`, `Set-ItemProperty HKLM:`),
`Set-ExecutionPolicy`, service changes (`Stop-Service`, `sc config`), `-EncodedCommand` and
other obfuscation, invisible/bidirectional Unicode characters, uploads carrying a credential
file or secret variable, scheduled tasks (`schtasks /create`, `Register-ScheduledTask`).

The approval card:

- Plain-language summary, risk level, "Details" with the exact command.
- **Allow once** · **Allow for this session** · **Always allow** · **Deny** (default).
- Times out after 5 minutes → denied (fail closed). A timed-out request is not reopened; the
  user asks again.
- A flagged command asks every time: "Allow for this session" and "Always allow" only cover
  calls with no flag, and are never offered for tools that always ask or need typed
  confirmation.
- "Always allow" (S10) remembers the exact PowerShell command (spaces normalised,
  case-insensitive) or, for other tools, the tool. Entries are listed and removable in Settings.
  Since flagged calls can't be always allowed, destructive classes (recursive delete, disk,
  registry, credential paths) never are.

YOLO mode (S10, "Auto" in the UI): a per-session toggle that skips layer 5 only, risky commands
included. While on, a red banner stays visible in the session with a button to turn it off,
which applies at once. Layers 1–4, typed confirmation, EPLAN tools that always ask, 6's backups
and 7–9 still apply. It is never remembered across restarts or window reloads.

Smart approvals (S10, off by default): before a card is shown for a PowerShell command with no
flag, the turn's own model is asked whether it only reads. Only an exact APPROVE runs it;
anything else, a failure or 20 s without an answer shows the card. Approval history (S10):
from the third request for the same command or tool, the card says how often the user allowed
it and suggests "Always allow". Calls allowed without a card say why in the activity log.

### 6. EPLAN project safety

Specific to Bochica:

- eplan-mcp tools are classified read-only vs. writing. Writing tools need approval by default;
  a session-level "allow EPLAN changes for this session" exists.
- Before the first writing tool call on a project in a session, Bochica makes a project backup
  and tells the user where it is. No backup, no write.
- Closing or restarting EPLAN (`eplan_app_shutdown`, `eplan_app_restart`) and deleting pages or
  projects always ask, even with session allowance, because they can lose unsaved work.
- Deleting projects, and other bulk-destructive actions, need **typed confirmation** (S6): the
  card has a text box and the action only runs after the user types the exact phrase it asks
  for (the project name, or a fixed word for bulk actions). Never allowed for the session, not
  skippable in YOLO mode.

### 7. Secret isolation

- MCP stdio servers and the terminal get a filtered environment: a safe list (`PATH`,
  `SYSTEMROOT`, `TEMP`, `USERPROFILE`, `LANG`…) plus what that server's config declares. API
  keys are never inherited.
- Tool output and errors are passed through `redactSecrets` before reaching the model or logs.
- Secrets never go into prompts.

### 8. Context-file injection scan

Files loaded into the system prompt (project instructions, skills) are scanned for prompt
injection: "ignore previous instructions", hidden HTML comments with suspicious keywords,
requests to read `.env`/credentials, exfiltration via `curl`/`iwr`, invisible Unicode. A hit
means the file is not loaded and the user sees why.

### 9. Network policy

URL-fetching tools refuse private, loopback, link-local and cloud-metadata addresses, re-check
every redirect, and treat DNS failure as blocked. A Settings switch allows private URLs for
users with LAN-only model servers (Ollama on another machine).

## Testing

Each layer gets table-driven tests in `packages/agent`: commands that must be blocked, that must
ask, and look-alikes that must pass (`Remove-Item .\build -Recurse` asks; `Remove-Item C:\
-Recurse` is hardline; `Get-ChildItem -Recurse` passes). Obfuscation variants (quotes inside
words, aliases like `rm`/`del`/`ri`, `-EncodedCommand`) are part of every table.
