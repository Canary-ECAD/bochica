import { describe, expect, test } from "bun:test";
import { mentionFor, parseMentions, parseSlashCommand } from "./commands";

describe("parseSlashCommand", () => {
  test.each([
    ["/plc-labels for page 3", { name: "plc-labels", args: "for page 3" }],
    ["/tasks", { name: "tasks", args: "" }],
    ["  /draw  ", { name: "draw", args: "" }],
    ["/report\nfirst line\nsecond", { name: "report", args: "first line\nsecond" }],
    ["/a1 x", { name: "a1", args: "x" }],
  ])("%p is a command", (text, expected) => {
    expect(parseSlashCommand(text)).toEqual(expected);
  });

  test.each([
    "what does /tasks do?",
    "/",
    "/ tasks",
    "/Tasks",
    "/-bad",
    "/bad-",
    "/path/to/file",
    "C:/Projects",
    "",
  ])("%p is not a command", (text) => {
    expect(parseSlashCommand(text)).toBeNull();
  });
});

describe("parseMentions", () => {
  test.each([
    ["look at @notes.txt", ["notes.txt"]],
    ["@scripts/Export.cs first", ["scripts/Export.cs"]],
    ['compare @"my file.txt" and @b.csv.', ["my file.txt", "b.csv"]],
    ["(see @a.txt) and @a.txt again", ["a.txt"]],
    ["line one\n@sub\\deep.md", ["sub\\deep.md"]],
    ["write to user@example.com", []],
    ["just an @ sign", []],
    ['broken @"quote', []],
  ])("%p mentions %p", (text, expected) => {
    expect(parseMentions(text)).toEqual(expected);
  });

  test("mentionFor quotes paths with spaces and round-trips", () => {
    expect(mentionFor("a/b.txt")).toBe("@a/b.txt");
    expect(mentionFor("My Docs/b.txt")).toBe('@"My Docs/b.txt"');
    expect(parseMentions(`read ${mentionFor("My Docs/b.txt")} now`)).toEqual(["My Docs/b.txt"]);
  });
});
