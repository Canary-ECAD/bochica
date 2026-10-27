import { describe, expect, test } from "bun:test";
import { diffFiles } from "./diff";

describe("diffFiles", () => {
  test("a new file is all additions", () => {
    expect(diffFiles("a.txt", "", "one\ntwo\n")).toEqual({
      path: "a.txt",
      added: 2,
      removed: 0,
      patch: "@@ -1,0 +1,2 @@\n+one\n+two",
    });
  });

  test("a changed line shows the removal first, with context", () => {
    const diff = diffFiles("a.txt", "one\ntwo\nthree\n", "one\nTWO\nthree\n");
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect(diff.patch).toBe("@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three");
  });

  test("CRLF and LF versions of the same text are the same", () => {
    expect(diffFiles("a.txt", "one\r\ntwo\r\n", "one\ntwo\n")).toMatchObject({
      added: 0,
      removed: 0,
      patch: "",
    });
  });

  test("distant changes become separate hunks", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 1", "first").replace("line 18", "last");
    const hunks = diffFiles("a.txt", before, after)
      .patch.split("\n")
      .filter((l) => l.startsWith("@@"));
    expect(hunks).toHaveLength(2);
  });
});
