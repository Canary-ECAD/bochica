import { commandStatements } from "./command-guard";

// Guardrails layer 3: the user's own "never allow" list. Each rule is a glob pattern (`*` any
// text, `?` one character), matched case-insensitively against the whole command and against
// each statement in it, so `Remove-Item*` also catches `cd x; rm y` and `Get-Item | ri`.
// A match blocks the command before anyone is asked, in every permission mode.

function ruleRegExp(rule: string): RegExp {
  let source = "";
  for (const c of rule.trim().replace(/\s+/g, " ")) {
    if (c === "*") source += ".*";
    else if (c === "?") source += ".";
    else source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "is");
}

/** The first rule that forbids the command, or null. */
export function deniedBy(command: string, rules: readonly string[]): string | null {
  if (rules.length === 0) return null;
  const whole = command.replace(/\s+/g, " ").trim();
  const candidates = [whole, ...(commandStatements(command) ?? [])];
  for (const rule of rules) {
    if (!rule.trim()) continue;
    const pattern = ruleRegExp(rule);
    if (candidates.some((candidate) => pattern.test(candidate))) return rule;
  }
  return null;
}
