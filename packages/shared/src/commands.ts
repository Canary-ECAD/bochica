// What the composer's two triggers mean in a sent message: `/name …` at the very start calls an
// app command or a skill, and `@path` points at a file. Main and the renderer read messages
// with the same functions, so what the menu offered is what main acts on.

/** Skill and command names: lowercase letters, digits and hyphens, as agentskills.io names. */
export const COMMAND_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface SlashCommand {
  name: string;
  /** Everything after the name, trimmed; may span several lines. */
  args: string;
}

/** `/name args` at the start of a message; null when the message is not a command. */
export function parseSlashCommand(text: string): SlashCommand | null {
  const match = /^\/([a-z0-9-]+)(?:[ \t]+|\r?\n|$)([\s\S]*)$/.exec(text.trimStart());
  const name = match?.[1];
  if (!name || !COMMAND_NAME.test(name)) return null;
  return { name, args: (match[2] ?? "").trim() };
}

/** How `@` writes a path: bare, or in double quotes when it has spaces. */
export function mentionFor(path: string): string {
  return /[\s"]/.test(path) ? `@"${path.replaceAll('"', "")}"` : `@${path}`;
}

/**
 * The `@path` mentions of a message, in order and without repeats. A mention starts the text
 * or follows whitespace, so e-mail addresses are not mentions. Trailing punctuation of a
 * sentence (`see @notes.txt.`) is not part of the path.
 */
export function parseMentions(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:^|\s)@(?:"([^"\r\n]+)"|([^\s"]+))/g)) {
    const path = (match[1] ?? match[2]?.replace(/[.,;:!?)\]]+$/, "") ?? "").trim();
    if (path && !found.includes(path)) found.push(path);
  }
  return found;
}
