import { describe, expect, test } from "bun:test";
import { activeTrigger, complete, matchByName } from "./composer-trigger";

/** `|` marks the cursor. */
function at(text: string) {
  const cursor = text.indexOf("|");
  return activeTrigger(text.replace("|", ""), cursor);
}

describe("activeTrigger", () => {
  test.each([
    ["/|", { kind: "command", query: "", start: 0, end: 1 }],
    ["/pl|", { kind: "command", query: "pl", start: 0, end: 3 }],
    ["  /ta|", { kind: "command", query: "ta", start: 2, end: 5 }],
    ["@|", { kind: "mention", query: "", start: 0, end: 1 }],
    ["read @scr|", { kind: "mention", query: "scr", start: 5, end: 9 }],
    ["read\n@sub/fi|le", { kind: "mention", query: "sub/fi", start: 5, end: 12 }],
  ])("%p", (text, expected) => {
    expect(at(text)).toEqual(expected as never);
  });

  test.each([
    "/tasks |",
    "hello /ta|",
    "/Ta|",
    "user@exa|",
    "read @file |",
    'read @"my fi|',
    "plain text|",
  ])("%p has no menu", (text) => {
    expect(at(text)).toBeNull();
  });
});

describe("complete", () => {
  test("replaces the typed part and adds a space", () => {
    const trigger = { kind: "mention" as const, query: "no", start: 5, end: 8 };
    expect(complete("read @no", trigger, "@notes.txt")).toEqual({
      text: "read @notes.txt ",
      cursor: 16,
    });
  });

  test("replaces the rest of a word the cursor was in, keeping the text after it", () => {
    const trigger = { kind: "command" as const, query: "pl", start: 0, end: 3 };
    expect(complete("/plxx do it", trigger, "/plc-labels")).toEqual({
      text: "/plc-labels do it",
      cursor: 12,
    });
  });
});

describe("matchByName", () => {
  test("prefix matches first, then substring matches", () => {
    const items = [{ name: "draw" }, { name: "plc-labels" }, { name: "labels" }, { name: "tasks" }];
    expect(matchByName(items, "la").map((i) => i.name)).toEqual(["labels", "plc-labels"]);
    expect(matchByName(items, "").length).toBe(4);
  });
});
