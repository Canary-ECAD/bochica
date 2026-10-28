import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovalRequest } from "@bochica/shared";
import { ApprovalService, type Judge } from "./approvals";
import { PermissionStore } from "./permissions";

const call = {
  callId: "c1",
  server: "docs",
  tool: "write",
  input: { x: 1 },
  approval: "ask" as const,
  fixed: false,
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bochica-approvals-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function setup(timeoutMs?: number, judge?: Judge) {
  const rules = new PermissionStore(join(root, "permissions.json"));
  const service = new ApprovalService({ rules, ...(timeoutMs ? { timeoutMs } : {}) });
  const sent: ApprovalRequest[] = [];
  const approver = service.approverFor(
    "session-1",
    "turn-1",
    (request) => sent.push(request),
    judge,
  );
  return { service, sent, approver, rules };
}

describe("ApprovalService", () => {
  test("sends a request and resolves with the user's answer", async () => {
    const { service, sent, approver } = setup();
    const answer = approver(call);
    expect(sent).toMatchObject([
      { turnId: "turn-1", server: "docs", tool: "write", input: { x: 1 }, allowSession: true },
    ]);
    service.respond(sent[0]?.requestId ?? "", "once");
    expect(await answer).toBe("allow");
  });

  test("deny denies", async () => {
    const { service, sent, approver } = setup();
    const answer = approver(call);
    service.respond(sent[0]?.requestId ?? "", "deny");
    expect(await answer).toBe("deny");
  });

  test("'once' asks again next time; 'session' does not", async () => {
    const { service, sent, approver } = setup();
    const first = approver(call);
    service.respond(sent[0]?.requestId ?? "", "once");
    await first;
    const second = approver(call);
    expect(sent).toHaveLength(2);
    service.respond(sent[1]?.requestId ?? "", "session");
    await second;
    expect(await approver(call)).toBe("allow");
    expect(sent).toHaveLength(2);
  });

  test("session allowance does not leak to another session or tool", async () => {
    const { service, sent, approver } = setup();
    const first = approver(call);
    service.respond(sent[0]?.requestId ?? "", "session");
    await first;

    const otherSession = service.approverFor("session-2", "turn-2", (r) => sent.push(r));
    void otherSession(call);
    void approver({ ...call, tool: "delete" });
    expect(sent).toHaveLength(3);
  });

  test("'always' tools ask every time, even after 'session'", async () => {
    const { service, sent, approver } = setup();
    const always = { ...call, approval: "always" as const, fixed: true };
    const first = approver(always);
    expect(sent[0]?.allowSession).toBe(false);
    service.respond(sent[0]?.requestId ?? "", "session");
    expect(await first).toBe("allow");
    void approver(always);
    expect(sent).toHaveLength(2);
  });

  test("typed confirmation: the right text allows, anything else denies", async () => {
    const { service, sent, approver } = setup();
    const destructive = {
      ...call,
      approval: "always" as const,
      confirm: { type: "name" as const, value: "Demo" },
    };

    const wrong = approver(destructive);
    expect(sent[0]).toMatchObject({
      allowSession: false,
      confirm: { type: "name", value: "Demo" },
    });
    service.respond(sent[0]?.requestId ?? "", "once", "demo");
    expect(await wrong).toBe("deny");

    const missing = approver(destructive);
    service.respond(sent[1]?.requestId ?? "", "once");
    expect(await missing).toBe("deny");

    const right = approver(destructive);
    service.respond(sent[2]?.requestId ?? "", "once", "Demo");
    expect(await right).toBe("allow");
  });

  test("no answer before the timeout means deny", async () => {
    const { approver } = setup(10);
    expect(await approver(call)).toBe("deny");
  });

  test("stopping the turn denies what is pending", async () => {
    const { service, approver } = setup();
    const answer = approver(call);
    service.cancelTurn("turn-1");
    expect(await answer).toBe("deny");
  });

  test("'always' remembers the call; the next one runs without a card, marked as a rule", async () => {
    const { service, sent, approver, rules } = setup();
    const first = approver(call);
    expect(sent[0]).toMatchObject({ allowAlways: true, allowedBefore: 0 });
    service.respond(sent[0]?.requestId ?? "", "always");
    expect(await first).toBe("allow");
    expect(rules.isAlwaysAllowed("docs", "write", {})).toBe(true);
    expect(await approver(call)).toEqual({ auto: "rule" });
    expect(sent).toHaveLength(1);
  });

  test("'always' is ignored for calls that ask every time", async () => {
    const { service, sent, approver, rules } = setup();
    const risky = { ...call, approval: "always" as const, risks: ["delete"] };
    const answer = approver(risky);
    expect(sent[0]).toMatchObject({ allowSession: false, allowAlways: false });
    expect(sent[0]?.allowedBefore).toBeUndefined();
    service.respond(sent[0]?.requestId ?? "", "always");
    expect(await answer).toBe("allow");
    expect(rules.isAlwaysAllowed("docs", "write", {})).toBe(false);
    expect(rules.allowedCount("docs", "write", {})).toBe(0);
  });

  test("the card says how often the user allowed this before", async () => {
    const { service, sent, approver } = setup();
    for (const decision of ["once", "once", "deny"] as const) {
      const answer = approver(call);
      service.respond(sent.at(-1)?.requestId ?? "", decision);
      // oxlint-disable-next-line no-await-in-loop
      await answer;
    }
    void approver(call);
    expect(sent.at(-1)?.allowedBefore).toBe(2);
  });

  test("Auto mode runs calls that would ask, risky ones too, until it is turned off", async () => {
    const { service, sent, approver } = setup();
    service.setAuto("session-1", true);
    expect(await approver(call)).toEqual({ auto: "auto" });
    expect(await approver({ ...call, approval: "always", risks: ["recursive-delete"] })).toEqual({
      auto: "auto",
    });
    expect(sent).toHaveLength(0);
    service.setAuto("session-1", false);
    void approver(call);
    expect(sent).toHaveLength(1);
  });

  test("Auto mode still asks for typed confirmations and tools that always ask", async () => {
    const { service, sent, approver } = setup();
    service.setAuto("session-1", true);
    void approver({ ...call, approval: "always", fixed: true });
    void approver({ ...call, approval: "always", confirm: { type: "word" } });
    expect(sent).toHaveLength(2);
  });

  test("clearing Auto mode turns it off for every session", async () => {
    const { service, sent, approver } = setup();
    service.setAuto("session-1", true);
    service.clearAuto();
    void approver(call);
    expect(sent).toHaveLength(1);
  });

  test("Auto mode belongs to one session", async () => {
    const { service, sent } = setup();
    service.setAuto("session-1", true);
    const other = service.approverFor("session-2", "turn-2", (r) => sent.push(r));
    void other(call);
    expect(sent).toHaveLength(1);
  });

  test("smart approval: a yes runs the call, a no shows the card; never for risky calls", async () => {
    const judged: unknown[] = [];
    const judge: Judge = async ({ input }) => {
      judged.push(input);
      return (input as { x: number }).x === 1;
    };
    const { sent, approver } = setup(undefined, judge);
    expect(await approver(call)).toEqual({ auto: "smart" });
    void approver({ ...call, input: { x: 2 } });
    await Bun.sleep(0);
    expect(sent).toHaveLength(1);
    void approver({ ...call, approval: "always", risks: ["delete"] });
    expect(judged).toHaveLength(2);
  });

  test("unknown or repeated responses are ignored", async () => {
    const { service, sent, approver } = setup();
    const answer = approver(call);
    service.respond("nope", "once");
    service.respond(sent[0]?.requestId ?? "", "deny");
    service.respond(sent[0]?.requestId ?? "", "once");
    expect(await answer).toBe("deny");
  });
});
