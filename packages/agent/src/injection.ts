// Guardrails layer 8: files that go into the system prompt (skills, later project
// instructions) are scanned for prompt injection before they are loaded. A file with any
// finding is not loaded at all, and the user is told why.

export type InjectionKind =
  | "override"
  | "hidden-comment"
  | "secret-read"
  | "exfiltration"
  | "invisible-chars";

export interface InjectionFinding {
  kind: InjectionKind;
  /** 1-based line where it was found. */
  line: number;
}

const OVERRIDE =
  /\b(ignore|disregard|forget|override)\b[^\n]{0,30}\b(previous|prior|above|earlier|system|all|your)\b[^\n]{0,30}\b(instructions?|prompts?|rules|directions)\b|\byou are now (a|an|in)\b|\bnew system prompt\b|\bdo not (tell|inform|show) the user\b/i;
const HIDDEN_COMMENT = /<!--([\s\S]*?)-->/g;
const SUSPICIOUS_IN_COMMENT =
  /\b(ignore|instructions?|system prompt|assistant|ai|model|password|secret|api[ _-]?key|token|curl|iwr|invoke-webrequest|exfiltrat\w*|upload)\b/i;
const SECRET_READ =
  /\b(read|cat|type|get-content|print|show|reveal|send|upload|copy)\b[^\n]{0,60}(\.env\b|credentials?\b|id_rsa|api[ _-]?keys?\b|\.ssh\b|passwords?\b)/i;
const EXFILTRATION =
  /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n]{0,160}(\$env:|%\w+%|\.env\b|token|api[ _-]?key|password|secret)/i;
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/;

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** What looks like prompt injection in a context file; empty when the file is fine. */
export function scanContextFile(text: string): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  // A byte-order mark at the very start is normal; anywhere else it hides text.
  const body = text.replace(/^﻿/, "");
  const lines = body.split("\n");
  lines.forEach((line, i) => {
    if (OVERRIDE.test(line)) findings.push({ kind: "override", line: i + 1 });
    if (SECRET_READ.test(line)) findings.push({ kind: "secret-read", line: i + 1 });
    if (EXFILTRATION.test(line)) findings.push({ kind: "exfiltration", line: i + 1 });
    if (INVISIBLE.test(line)) findings.push({ kind: "invisible-chars", line: i + 1 });
  });
  for (const match of body.matchAll(HIDDEN_COMMENT)) {
    if (SUSPICIOUS_IN_COMMENT.test(match[1] ?? "")) {
      findings.push({ kind: "hidden-comment", line: lineAt(body, match.index) });
    }
  }
  return findings.toSorted((a, b) => a.line - b.line);
}
