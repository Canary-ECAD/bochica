// Which menu the composer should show for the text around the cursor: `/` at the start of the
// message lists commands and skills, `@` at the start of a word lists files. Pure functions,
// so they can be tested without a DOM.

export interface Trigger {
  kind: "command" | "mention";
  /** What the user typed after `/` or `@`. */
  query: string;
  /** The range the picked item replaces, `/` or `@` included. */
  start: number;
  end: number;
}

/** The trigger the cursor is in, or null. */
export function activeTrigger(text: string, cursor: number): Trigger | null {
  const before = text.slice(0, cursor);
  const command = /^(\s*)\/([a-z0-9-]*)$/.exec(before);
  if (command) {
    const start = command[1]?.length ?? 0;
    return { kind: "command", query: command[2] ?? "", start, end: cursor };
  }
  const mention = /(?:^|\s)@([^\s"]*)$/.exec(before);
  if (mention) {
    const query = mention[1] ?? "";
    return { kind: "mention", query, start: cursor - query.length - 1, end: cursor };
  }
  return null;
}

/** The text with the trigger replaced by `insert` and a space, and where the cursor goes. */
export function complete(
  text: string,
  trigger: Trigger,
  insert: string,
): { text: string; cursor: number } {
  const after = text.slice(trigger.end).replace(/^[^\s]*/, "");
  const head = `${text.slice(0, trigger.start)}${insert}${after.startsWith(" ") ? "" : " "}`;
  return { text: head + after, cursor: head.length + (after.startsWith(" ") ? 1 : 0) };
}

/** Items whose name starts with the query come first, then those that contain it. */
export function matchByName<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.toLowerCase();
  const starts = items.filter((item) => item.name.toLowerCase().startsWith(q));
  const contains = items.filter(
    (item) => !item.name.toLowerCase().startsWith(q) && item.name.toLowerCase().includes(q),
  );
  return [...starts, ...contains];
}
