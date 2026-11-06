import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupGuard, pinnedTarget } from "./backup";

// Made-up projects; nothing here touches EPLAN.
const demo = "C:\\Projects\\Demo.elk";
const other = "C:\\Projects\\Other.elk";

let root: string;
let calls: Array<{ tool: string; args: Record<string, unknown> }>;
let current: string | null;
let backupFails: boolean;

const fakeEplan = async (tool: string, args: Record<string, unknown>) => {
  calls.push({ tool, args });
  if (tool === "eplan_get_current_project") {
    return current
      ? { ok: true, text: JSON.stringify({ success: true, parameters: { PROJECT: current } }) }
      : { ok: true, text: JSON.stringify({ success: false }) };
  }
  if (tool === "eplan_backup_project") {
    return backupFails
      ? { ok: true, text: JSON.stringify({ success: false, error: "disk full" }) }
      : { ok: true, text: JSON.stringify({ success: true }) };
  }
  throw new Error(`unexpected ${tool}`);
};

const backups = () => calls.filter((c) => c.tool === "eplan_backup_project");
const answer = (body: unknown) => ({ ok: true, text: JSON.stringify(body) });
const guard = () => new BackupGuard(fakeEplan, root, () => new Date(2026, 9, 27, 14, 5, 9));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bochica-backup-"));
  calls = [];
  current = demo;
  backupFails = false;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("BackupGuard", () => {
  test("backs up the current project once per session", async () => {
    const g = guard();
    expect(await g.ensure("s1", {})).toEqual({
      status: "done",
      project: "Demo",
      archive: join(root, "Demo", "Demo-20261027-140509.zw1"),
    });
    expect(await g.ensure("s1", {})).toEqual({ status: "already", project: "Demo" });
    expect(backups()).toHaveLength(1);
    expect(backups()[0]?.args).toEqual({
      destination_path: join(root, "Demo"),
      archive_name: "Demo-20261027-140509.zw1",
      project_name: demo,
      backup_method: "BACKUP",
    });
  });

  test("a new session backs up again", async () => {
    const g = guard();
    await g.ensure("s1", {});
    await g.ensure("s2", {});
    expect(backups()).toHaveLength(2);
  });

  test("a project named in the call is backed up instead of the current one", async () => {
    const g = guard();
    await g.ensure("s1", { project_name: other, page: "1" });
    expect(backups()[0]?.args["project_name"]).toBe(other);
    expect(calls.some((c) => c.tool === "eplan_get_current_project")).toBe(false);
  });

  test("a pinned target project is backed up, not the current one", async () => {
    const g = guard();
    g.setTarget(other);
    const result = await g.ensure("s1", { page: "=A+B/1" });
    expect(result).toMatchObject({ status: "done", project: "Other" });
    expect(backups()[0]?.args["project_name"]).toBe(other);
    expect(calls.some((c) => c.tool === "eplan_get_current_project")).toBe(false);
    // A project named in the call still wins, as in eplan-mcp.
    await g.ensure("s1", { project_name: demo });
    expect(backups()[1]?.args["project_name"]).toBe(demo);
    // Cleared: back to the current project.
    g.setTarget("");
    expect(await g.ensure("s2", {})).toMatchObject({ project: "Demo" });
  });

  test("the pinned target is read from eplan_live_set_target_project's answer", () => {
    expect(pinnedTarget(answer({ success: true, target: other, previous: "" }))).toBe(other);
    expect(pinnedTarget(answer({ success: true, target: "", previous: other }))).toBe("");
    expect(pinnedTarget(answer({ success: false, error: "not open" }))).toBeUndefined();
    expect(pinnedTarget({ ok: false, text: "boom" })).toBeUndefined();
    expect(pinnedTarget({ ok: true, text: "not json" })).toBeUndefined();
  });

  test("another project in the same session gets its own backup", async () => {
    const g = guard();
    await g.ensure("s1", {});
    await g.ensure("s1", { project_name: other });
    expect(backups().map((b) => b.args["project_name"])).toEqual([demo, other]);
  });

  test("no open project means nothing to back up", async () => {
    current = null;
    expect(await guard().ensure("s1", {})).toEqual({ status: "no-project" });
    expect(backups()).toEqual([]);
  });

  test("a failed backup throws, and the next call tries again", async () => {
    const g = guard();
    backupFails = true;
    await expect(g.ensure("s1", {})).rejects.toThrow("could not back up Demo");
    backupFails = false;
    expect((await g.ensure("s1", {})).status).toBe("done");
  });

  test("reports the project before starting", async () => {
    const started: string[] = [];
    await guard().ensure("s1", {}, (project) => started.push(project));
    expect(started).toEqual(["Demo"]);
  });
});
