import { describe, expect, test } from "bun:test";
import type { ApprovalRequest } from "@bochica/shared";
import { ApprovalService } from "./approvals";

const call = { callId: "c1", server: "docs", tool: "write", input: { x: 1 } };

function setup(timeoutMs?: number) {
  const service = new ApprovalService(timeoutMs);
  const sent: ApprovalRequest[] = [];
  const approver = service.approverFor("session-1", "turn-1", (request) => sent.push(request));
  return { service, sent, approver };
}

describe("ApprovalService", () => {
  test("sends a request and resolves with the user's answer", async () => {
    const { service, sent, approver } = setup();
    const answer = approver(call);
    expect(sent).toMatchObject([
      { turnId: "turn-1", server: "docs", tool: "write", input: { x: 1 } },
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

  test("unknown or repeated responses are ignored", async () => {
    const { service, sent, approver } = setup();
    const answer = approver(call);
    service.respond("nope", "once");
    service.respond(sent[0]?.requestId ?? "", "deny");
    service.respond(sent[0]?.requestId ?? "", "once");
    expect(await answer).toBe("deny");
  });
});
