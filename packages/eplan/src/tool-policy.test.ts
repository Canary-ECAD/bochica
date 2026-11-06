import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contractChanges, contractTools, ToolContract } from "./contract";
import {
  EPLAN_META_KEY,
  type EplanToolInfo,
  type EplanToolPolicy,
  eplanOverrides,
  eplanToolPolicy,
  policyFromFacts,
} from "./tool-policy";

const fixture = (name: string) => join(import.meta.dir, "fixtures", name);

// The tool contract of the eplan-mcp version pinned in components.lock.json, written by
// `prepare-runtime --lock` (run by `components:bump eplan-mcp`).
const contract = ToolContract.parse(
  JSON.parse(readFileSync(fixture("eplan-mcp-tools.json"), "utf8")),
);
const pinned = contractTools(contract);

/**
 * What Bochica does with each pinned tool, reviewed by hand. It is the classification from before
 * S14 (when the lists lived here), with the one difference agreed then: eplan_run_project_action
 * runs any action, so it asks every time like eplan_action_run. When a bump changes a line, the
 * test below fails: check the change is wanted and update the file in the same commit.
 */
const expected: Record<string, string> = JSON.parse(
  readFileSync(fixture("eplan-tool-policies.json"), "utf8"),
);

const label = (tool: EplanToolInfo) => {
  const policy = eplanToolPolicy(tool);
  return policy.approval + (policy.changesProject ? " + backup" : "");
};

/** Words that mean a tool changes something; a read tool must not contain any of them. */
const writeWords =
  /(^|_)(set|delete|remove|import|create|update|renumber|generate|execute|run|register|restore|rename|insert|place|unite|correct|translate|change|lock|upgrade|compress|convert|discard|shutdown|restart|launch)(_|$)/;

const facts = (
  changes: Partial<Record<"changesProject" | "runsCode" | "changesEplan", boolean>>,
) => ({
  [EPLAN_META_KEY]: { changesProject: false, runsCode: false, changesEplan: false, ...changes },
});
const hints = (readOnlyHint: boolean, destructiveHint = false) => ({
  readOnlyHint,
  destructiveHint,
  idempotentHint: readOnlyHint,
  openWorldHint: false,
});

describe("eplan tool policy", () => {
  test("every pinned tool states its annotations and facts", () => {
    const bare = contract.tools.filter(
      (t) => t.facts === null || t.annotations["readOnlyHint"] === null,
    );
    expect(bare.map((t) => t.name)).toEqual([]);
  });

  test("every pinned tool gets the reviewed policy", () => {
    const actual = Object.fromEntries(pinned.map((tool) => [tool.name, label(tool)]));
    expect(actual).toEqual(expected);
  });

  test("every override names a pinned tool and says why", () => {
    for (const [name, { reason }] of Object.entries(eplanOverrides)) {
      expect(pinned.map((t) => t.name)).toContain(name);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  test("no read tool has a name that suggests a change", () => {
    const suspicious = pinned.filter(
      (t) => eplanToolPolicy(t).approval === "never" && writeWords.test(t.name),
    );
    expect(suspicious.map((t) => t.name)).toEqual([]);
  });

  test("the guardrails' named cases always ask", () => {
    for (const name of ["eplan_app_shutdown", "eplan_app_restart", "eplan_project_management"]) {
      const tool = pinned.find((t) => t.name === name);
      expect(tool && eplanToolPolicy(tool).approval).toBe("always");
    }
  });

  test("a tool without annotations or facts asks and gets a backup", () => {
    const unknown: EplanToolPolicy = { approval: "ask", changesProject: true };
    expect(eplanToolPolicy({ name: "eplan_something_new" })).toEqual(unknown);
    expect(eplanToolPolicy({ name: "x", annotations: hints(true) })).toEqual(unknown);
    expect(eplanToolPolicy({ name: "x", meta: facts({}) })).toEqual(unknown);
    // Half the facts, or hints left to MCP's defaults, count as none.
    expect(
      eplanToolPolicy({ name: "x", annotations: hints(true), meta: { [EPLAN_META_KEY]: {} } }),
    ).toEqual(unknown);
    expect(
      eplanToolPolicy({ name: "x", annotations: { readOnlyHint: true }, meta: facts({}) }),
    ).toEqual(unknown);
  });

  test.each([
    ["read", hints(true), facts({}), "never"],
    ["writes a file outside the project", hints(false), facts({}), "ask"],
    ["changes the project", hints(false), facts({ changesProject: true }), "ask + backup"],
    ["destructive", hints(false, true), facts({ changesProject: true }), "always + backup"],
    ["runs code", hints(false), facts({ runsCode: true }), "always"],
    ["changes EPLAN", hints(false), facts({ changesEplan: true }), "always"],
    // A contradiction is read the careful way.
    [
      "read-only but changes the project",
      hints(true),
      facts({ changesProject: true }),
      "ask + backup",
    ],
    ["read-only but destructive", hints(true, true), facts({}), "always"],
  ] as const)("from the facts: %s → %s", (_case, annotations, meta, policy) => {
    expect(label({ name: "eplan_demo", annotations, meta })).toBe(policy);
  });

  test("an override wins over the facts", () => {
    const tool = {
      name: "eplan_lock_unlock_all_objects",
      annotations: hints(true),
      meta: facts({}),
    };
    expect(policyFromFacts(tool).approval).toBe("never");
    expect(eplanToolPolicy(tool)).toEqual({ approval: "always", changesProject: true });
  });
});

const tool = (name: string, readOnly: boolean, changesProject: boolean) => ({
  name,
  annotations: hints(readOnly),
  facts: facts({ changesProject })[EPLAN_META_KEY],
});

describe("contract changes", () => {
  const before = {
    mode: "full",
    tools: [tool("eplan_a", false, true), tool("eplan_gone", true, false)],
  };

  test("lists added, removed and re-annotated tools", () => {
    const after = {
      mode: "full",
      tools: [tool("eplan_a", false, false), tool("eplan_new", true, false)],
    };
    expect(contractChanges(before, after)).toEqual({
      added: ["eplan_new"],
      removed: ["eplan_gone"],
      reannotated: [{ name: "eplan_a", changes: ["changesProject true → false"] }],
      nowReadOnly: [],
    });
  });

  test("flags a write tool that became read-only", () => {
    const after = {
      mode: "full",
      tools: [tool("eplan_a", true, false), tool("eplan_gone", true, false)],
    };
    const changes = contractChanges(before, after);
    expect(changes.nowReadOnly).toEqual(["eplan_a"]);
    expect(changes.reannotated[0]?.changes).toEqual([
      "idempotentHint false → true",
      "readOnlyHint false → true",
      "changesProject true → false",
    ]);
  });

  test("the pinned contract compared with itself changes nothing", () => {
    expect(contractChanges(contract, contract)).toEqual({
      added: [],
      removed: [],
      reannotated: [],
      nowReadOnly: [],
    });
  });
});
