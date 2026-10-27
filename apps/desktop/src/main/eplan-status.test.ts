import { describe, expect, test } from "bun:test";
import type { EplanStatus } from "@bochica/shared";
import { type EplanStatusDeps, EplanStatusService } from "./eplan-status";

interface Fake {
  configured?: boolean;
  server?: { state: string; error?: string };
  connected?: boolean;
  ping?: { alive: boolean; timed_out?: boolean };
  connectSucceeds?: boolean;
  running?: boolean;
}

function deps(fake: Fake): EplanStatusDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    configured: () => fake.configured ?? true,
    serverState: () => fake.server ?? { state: "ready" },
    callTool: async (tool) => {
      calls.push(tool);
      if (tool === "eplan_status") {
        return {
          ok: true,
          text: JSON.stringify({ connected: fake.connected ?? false, target_version: "2026" }),
        };
      }
      if (tool === "eplan_ping")
        return { ok: true, text: JSON.stringify(fake.ping ?? { alive: true }) };
      if (tool === "eplan_connect") {
        return fake.connectSucceeds
          ? { ok: true, text: JSON.stringify({ success: true, target_version: "2026" }) }
          : {
              ok: true,
              text: JSON.stringify({ success: false, error: "failed to connect to all addresses" }),
            };
      }
      throw new Error(tool);
    },
    isEplanRunning: async () => fake.running ?? false,
  };
}

async function evaluate(fake: Fake): Promise<{ status: EplanStatus; calls: string[] }> {
  const d = deps(fake);
  const service = new EplanStatusService(d, () => {});
  await service.check();
  return { status: service.current(), calls: d.calls };
}

describe("EplanStatusService", () => {
  test("not configured: no calls at all", async () => {
    expect(await evaluate({ configured: false })).toEqual({
      status: { state: "not_configured" },
      calls: [],
    });
  });

  test("server still starting", async () => {
    expect((await evaluate({ server: { state: "connecting" } })).status).toEqual({
      state: "starting",
    });
  });

  test("server failed to start", async () => {
    expect(
      (await evaluate({ server: { state: "error", error: "python not found" } })).status,
    ).toEqual({
      state: "error",
      detail: "python not found",
    });
  });

  test("already connected and alive", async () => {
    const { status, calls } = await evaluate({ connected: true });
    expect(status).toEqual({ state: "connected", version: "2026" });
    expect(calls).toEqual(["eplan_status", "eplan_ping"]);
  });

  test("connected but EPLAN does not answer: busy", async () => {
    const { status } = await evaluate({ connected: true, ping: { alive: false, timed_out: true } });
    expect(status).toEqual({ state: "busy", version: "2026" });
  });

  test("not connected yet: connects on its own", async () => {
    const { status, calls } = await evaluate({ connectSucceeds: true });
    expect(status).toEqual({ state: "connected", version: "2026" });
    expect(calls).toEqual(["eplan_status", "eplan_connect"]);
  });

  test("connect fails while EPLAN runs: Remote Client is probably off", async () => {
    expect((await evaluate({ running: true })).status).toEqual({ state: "unreachable" });
  });

  test("connect fails and EPLAN is not running: closed", async () => {
    expect((await evaluate({ running: false })).status).toEqual({ state: "closed" });
  });

  test("notifies only on change", async () => {
    const seen: EplanStatus[] = [];
    const service = new EplanStatusService(deps({ connected: true }), (s) => seen.push(s));
    await service.check();
    await service.check();
    expect(seen).toEqual([{ state: "connected", version: "2026" }]);
  });
});
