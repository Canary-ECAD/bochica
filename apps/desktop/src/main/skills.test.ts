import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillStore } from "./skills";

const skillMd = `---
name: eplan-scripting
description: Write EPLAN C# scripts
---

# EPLAN scripting

Use the API carefully.`;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bochica-skills-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fakeGitHub(): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const files: Record<string, string> = {
    "skills/eplan-p8/eplan-scripting/SKILL.md": skillMd,
    "skills/eplan-p8/eplan-scripting/references/pitfalls.md": "Dispose everything.",
    "README.md": "not a skill",
  };
  const impl = async (url: string | URL | Request) => {
    const href = String(url);
    calls.push(href);
    if (href.includes("/git/trees/")) {
      return Response.json({ tree: Object.keys(files).map((path) => ({ path, type: "blob" })) });
    }
    const path = href.split("/abc123/")[1] ?? "";
    return files[path] === undefined
      ? new Response("", { status: 404 })
      : new Response(files[path]);
  };
  return { fetch: Object.assign(impl, { preconnect: () => {} }), calls };
}

const source = { repository: "https://github.com/Example/skill", commit: "abc123" };

describe("SkillStore", () => {
  test("downloads the pinned commit once, then reads from the cache", async () => {
    const github = fakeGitHub();
    const store = new SkillStore(root, source, github.fetch);
    const skills = await store.load();
    expect(skills).toEqual([
      {
        name: "eplan-scripting",
        description: "Write EPLAN C# scripts",
        body: "# EPLAN scripting\n\nUse the API carefully.",
        references: ["eplan-p8/eplan-scripting/references/pitfalls.md"],
      },
    ]);
    expect(github.calls.some((c) => c.includes("README"))).toBe(false);
    expect(existsSync(join(root, ".complete"))).toBe(true);

    const again = fakeGitHub();
    await new SkillStore(root, source, again.fetch).load();
    expect(again.calls).toEqual([]);
  });

  test("a local checkout is read without downloading", async () => {
    mkdirSync(join(root, "eplan-p8", "eplan-scripting"), { recursive: true });
    writeFileSync(join(root, "eplan-p8", "eplan-scripting", "SKILL.md"), skillMd);
    const skills = await new SkillStore(root, null).load();
    expect(skills.map((s) => s.name)).toEqual(["eplan-scripting"]);
  });

  test("no network: no skills, no crash", async () => {
    const offline = Object.assign(
      async (): Promise<Response> => {
        throw new TypeError("fetch failed");
      },
      { preconnect: () => {} },
    );
    expect(await new SkillStore(root, source, offline).load()).toEqual([]);
  });

  test("the read tool returns reference files", async () => {
    const store = new SkillStore(root, source, fakeGitHub().fetch);
    await store.load();
    const result = await store
      .readTool()
      .execute(
        { path: "eplan-p8/eplan-scripting/references/pitfalls.md" },
        new AbortController().signal,
      );
    expect(result).toEqual({ ok: true, text: "Dispose everything." });
  });

  test.each([
    "../../../Windows/win.ini",
    "..\\..\\secret.txt",
    "C:\\Windows\\win.ini",
    "/etc/passwd",
    "eplan-p8/../../outside.md",
    "",
  ])("refuses to read outside the skill: %p", async (path) => {
    const store = new SkillStore(root, source, fakeGitHub().fetch);
    await store.load();
    const result = await store.readTool().execute({ path }, new AbortController().signal);
    expect(result.ok).toBe(false);
  });
});
