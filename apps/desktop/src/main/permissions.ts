import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type AlwaysAllowRule, Permissions } from "@bochica/shared";
import { z } from "zod";

// The user's permission rules (guardrails layers 3 and 5), in userData\permissions.json:
// "Always allow" rules, "Never allow" patterns, the smart approvals switch, and how often each
// command or tool was allowed, for the "always allow it?" suggestion.

const PermissionsFile = Permissions.extend({
  version: z.literal(1),
  /** Rule key → how many times the user allowed it from a card. */
  allowed: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
type PermissionsFile = z.infer<typeof PermissionsFile>;

/** Keys kept in the approval counts; the oldest go first. */
const MAX_COUNTED = 500;

function text(input: unknown, name: string): string {
  const value =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)[name]
      : undefined;
  return typeof value === "string" ? value : "";
}

/**
 * The rule that would always allow this call: the exact command for PowerShell (spaces
 * normalised), the tool for everything else. Null when there is no command to remember.
 */
export function ruleFor(server: string, tool: string, input: unknown): AlwaysAllowRule | null {
  if (server === "bochica" && tool === "powershell") {
    const command = text(input, "command").trim().replace(/\s+/g, " ");
    return command ? { kind: "command", command } : null;
  }
  return { kind: "tool", server, tool };
}

/** Commands compare case-insensitively, as PowerShell reads them. */
function keyOf(rule: AlwaysAllowRule): string {
  return rule.kind === "command"
    ? `command\u0000${rule.command.toLowerCase()}`
    : `tool\u0000${rule.server}\u0000${rule.tool}`;
}

/** What the approval service needs from the stored rules. */
export interface ApprovalRules {
  canAlwaysAllow(server: string, tool: string, input: unknown): boolean;
  isAlwaysAllowed(server: string, tool: string, input: unknown): boolean;
  allowAlways(server: string, tool: string, input: unknown): void;
  /** Counts one more time the user allowed this call from a card. */
  recordAllowed(server: string, tool: string, input: unknown): void;
  allowedCount(server: string, tool: string, input: unknown): number;
}

export class PermissionStore implements ApprovalRules {
  private data: PermissionsFile;

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  get(): Permissions {
    const { alwaysAllow, denyRules, smart } = this.data;
    return { alwaysAllow, denyRules, smart };
  }

  /** Replaces the rules the user edits in Settings; duplicates are dropped. */
  set(permissions: Permissions): Permissions {
    const seen = new Set<string>();
    const alwaysAllow = permissions.alwaysAllow.filter((rule) => {
      const key = keyOf(rule);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const denyRules = [...new Set(permissions.denyRules.map((rule) => rule.trim()))].filter(
      Boolean,
    );
    this.data = { ...this.data, alwaysAllow, denyRules, smart: permissions.smart };
    this.persist();
    return this.get();
  }

  denyRules(): readonly string[] {
    return this.data.denyRules;
  }

  smart(): boolean {
    return this.data.smart;
  }

  canAlwaysAllow(server: string, tool: string, input: unknown): boolean {
    return ruleFor(server, tool, input) !== null;
  }

  isAlwaysAllowed(server: string, tool: string, input: unknown): boolean {
    const rule = ruleFor(server, tool, input);
    if (!rule) return false;
    const key = keyOf(rule);
    return this.data.alwaysAllow.some((saved) => keyOf(saved) === key);
  }

  allowAlways(server: string, tool: string, input: unknown): void {
    const rule = ruleFor(server, tool, input);
    if (!rule || this.isAlwaysAllowed(server, tool, input)) return;
    this.data = { ...this.data, alwaysAllow: [...this.data.alwaysAllow, rule] };
    this.persist();
  }

  recordAllowed(server: string, tool: string, input: unknown): void {
    const rule = ruleFor(server, tool, input);
    if (!rule) return;
    const key = keyOf(rule);
    const { [key]: count = 0, ...others } = this.data.allowed;
    // Re-inserted last, so the least recently allowed are the first to be dropped.
    const entries = Object.entries(others).slice(-(MAX_COUNTED - 1));
    this.data = { ...this.data, allowed: Object.fromEntries([...entries, [key, count + 1]]) };
    this.persist();
  }

  allowedCount(server: string, tool: string, input: unknown): number {
    const rule = ruleFor(server, tool, input);
    return rule ? (this.data.allowed[keyOf(rule)] ?? 0) : 0;
  }

  private load(): PermissionsFile {
    const empty: PermissionsFile = {
      version: 1,
      alwaysAllow: [],
      denyRules: [],
      smart: false,
      allowed: {},
    };
    if (!existsSync(this.file)) return empty;
    try {
      return PermissionsFile.parse(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      // Unreadable rules are set aside, not guessed at: everything asks again.
      renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      return empty;
    }
  }

  private persist(): void {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2));
    renameSync(temp, this.file);
  }
}
