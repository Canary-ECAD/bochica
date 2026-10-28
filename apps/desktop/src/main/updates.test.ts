import { describe, expect, test } from "bun:test";
import type { UpdateStatus } from "@bochica/shared";
import { localFeed, type Updater, updateErrorKind, UpdateService } from "./updates";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An updater whose download finishes when the test says so. */
function fakeUpdater(latest: string | null = "0.3.0") {
  const calls: string[] = [];
  let finish: ((error?: Error) => void) | undefined;
  let progress: ((percent: number) => void) | undefined;
  const updater: Updater & { latest: string | null; checkError?: Error; installError?: Error } = {
    latest,
    check: async () => {
      calls.push("check");
      if (updater.checkError) throw updater.checkError;
      return updater.latest;
    },
    download: (onProgress) => {
      calls.push("download");
      progress = onProgress;
      return new Promise<void>((resolve, reject) => {
        finish = (error) => (error ? reject(error) : resolve());
      });
    },
    install: async () => {
      calls.push("install");
      if (updater.installError) throw updater.installError;
    },
  };
  return {
    updater,
    calls,
    finish: async (error?: Error) => {
      finish?.(error);
      await settle();
    },
    progress: (percent: number) => progress?.(percent),
  };
}

function setup(updater: Updater | null, busy = false) {
  const statuses: UpdateStatus[] = [];
  const steps: string[] = [];
  const errors: string[] = [];
  const state = { busy };
  const service = new UpdateService({
    updater,
    current: "0.2.0",
    busy: () => state.busy,
    prepareInstall: async () => {
      steps.push("prepare");
    },
    cancelInstall: () => steps.push("cancel"),
    notesUrl: (version) => `https://example.com/v${version}`,
    logger: { info: () => {}, error: (message) => errors.push(message) },
    onChange: (status) => statuses.push(status),
  });
  return { service, statuses, steps, errors, state };
}

describe("UpdateService", () => {
  test("is off without an updater, and checking does nothing", async () => {
    const { service, statuses } = setup(null);
    expect(service.current()).toEqual({
      state: "off",
      current: "0.2.0",
      deferred: false,
      waiting: false,
    });
    expect((await service.check(true)).state).toBe("off");
    expect(statuses).toEqual([]);
  });

  test("a check finds a new version but downloads nothing on its own", async () => {
    const fake = fakeUpdater();
    const { service } = setup(fake.updater);
    const status = await service.check(false);
    expect(status).toMatchObject({
      state: "available",
      version: "0.3.0",
      notesUrl: "https://example.com/v0.3.0",
    });
    expect(fake.calls).toEqual(["check"]);
  });

  test("nothing new: idle, with the time of the check", async () => {
    const { service } = setup(fakeUpdater(null).updater);
    const status = await service.check(true);
    expect(status.state).toBe("idle");
    expect(status.upToDateAt).toBeNumber();
  });

  test("Update now downloads with progress, then prepares and installs", async () => {
    const fake = fakeUpdater();
    const { service, steps } = setup(fake.updater);
    await service.check(false);
    expect(service.install().state).toBe("downloading");
    fake.progress(42.7);
    expect(service.current().percent).toBe(42);
    await fake.finish();
    expect(steps).toEqual(["prepare"]);
    expect(fake.calls).toEqual(["check", "download", "install"]);
  });

  test("a running task makes the restart wait until the last turn ends", async () => {
    const fake = fakeUpdater();
    const { service, state } = setup(fake.updater, true);
    await service.check(false);
    service.install();
    await fake.finish();
    expect(service.current()).toMatchObject({ state: "ready", waiting: true });
    expect(fake.calls).not.toContain("install");
    state.busy = false;
    service.idle();
    await settle();
    expect(fake.calls).toContain("install");
    expect(service.current().waiting).toBe(false);
  });

  test("Later hides the notice, downloads quietly and never restarts", async () => {
    const fake = fakeUpdater();
    const { service } = setup(fake.updater);
    await service.check(false);
    expect(service.later()).toMatchObject({ state: "downloading", deferred: true });
    await fake.finish();
    expect(service.current()).toMatchObject({ state: "ready", deferred: true });
    service.idle();
    await settle();
    expect(fake.calls).not.toContain("install");
  });

  test("Update now after Later restarts at once", async () => {
    const fake = fakeUpdater();
    const { service } = setup(fake.updater);
    await service.check(false);
    service.later();
    await fake.finish();
    expect(service.install().deferred).toBe(false);
    await settle();
    expect(fake.calls).toContain("install");
  });

  test("a later check keeps Later for the same version, not for a newer one", async () => {
    const fake = fakeUpdater();
    const { service } = setup(fake.updater);
    await service.check(false);
    service.later();
    await fake.finish(new Error("socket hang up"));
    expect(service.current()).toMatchObject({ state: "available", deferred: true });
    expect((await service.check(false)).deferred).toBe(true);
    await fake.finish();
    fake.updater.latest = "0.4.0";
    // Ready: no more checks until it's installed.
    expect((await service.check(false)).state).toBe("ready");
  });

  test("a failed check in the background is only logged; a manual one shows", async () => {
    const fake = fakeUpdater();
    fake.updater.checkError = Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), {
      code: "ENOTFOUND",
    });
    const { service, errors } = setup(fake.updater);
    expect((await service.check(false)).state).toBe("idle");
    expect(errors).toHaveLength(1);
    expect(await service.check(true)).toMatchObject({
      state: "error",
      error: "offline",
      failedDuring: "check",
    });
  });

  test("a failed download shows an error, and Try again downloads again", async () => {
    const fake = fakeUpdater();
    const { service } = setup(fake.updater);
    await service.check(false);
    service.install();
    await fake.finish(new Error("sha512 checksum mismatch"));
    expect(service.current()).toMatchObject({
      state: "error",
      error: "failed",
      failedDuring: "download",
      version: "0.3.0",
    });
    expect(service.install().state).toBe("downloading");
  });

  test("an installer that can't start brings the servers back and shows an error", async () => {
    const fake = fakeUpdater();
    fake.updater.installError = new Error("spawn EACCES");
    const { service, steps } = setup(fake.updater);
    await service.check(false);
    service.install();
    await fake.finish();
    expect(steps).toEqual(["prepare", "cancel"]);
    expect(service.current()).toMatchObject({ state: "error", failedDuring: "install" });
  });

  test("a background check doesn't hide a download or install error", async () => {
    const fake = fakeUpdater();
    const { service } = setup(fake.updater);
    await service.check(false);
    service.install();
    await fake.finish(new Error("broken"));
    expect((await service.check(false)).state).toBe("error");
    expect(fake.calls.filter((c) => c === "check")).toHaveLength(1);
  });
});

describe("updateErrorKind", () => {
  test.each([
    ["getaddrinfo ENOTFOUND github.com", "offline"],
    ["net::ERR_INTERNET_DISCONNECTED", "offline"],
    ["net::ERR_PROXY_CONNECTION_FAILED", "offline"],
    ["connect ETIMEDOUT 140.82.112.3:443", "offline"],
    ["sha512 checksum mismatch", "failed"],
    ["Cannot find latest.yml in the latest release artifacts", "failed"],
  ])("%s → %s", (message, kind) => {
    expect(updateErrorKind(new Error(message))).toBe(kind as "offline" | "failed");
  });
});

describe("localFeed", () => {
  test.each([
    [undefined, null],
    ["http://127.0.0.1:8765/", "http://127.0.0.1:8765/"],
    ["http://localhost:8765/feed", "http://localhost:8765/feed"],
    ["https://example.com/feed", null],
    ["http://192.168.1.10/feed", null],
    ["http://127.0.0.1.example.com/", null],
    ["file:///C:/feed", null],
    ["not a url", null],
  ])("%s → %s", (value, expected) => {
    expect(localFeed(value === undefined ? {} : { BOCHICA_UPDATE_URL: value })).toBe(expected);
  });
});
