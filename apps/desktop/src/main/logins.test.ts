import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoginError, type pkceLogin } from "@bochica/agent";
import { CredentialStore, type Encryptor } from "./credentials";
import type { Logger } from "./logger";
import { LoginService } from "./logins";

const encryptor: Encryptor = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain, "utf8"),
  decryptString: (data) => data.toString("utf8"),
};
const logger: Logger = { info: () => {}, error: () => {} };
const request = {
  provider: "openrouter" as const,
  label: "OpenRouter sign-in",
  page: { done: "Done", failed: "Failed" },
};

let dir: string;
let store: CredentialStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bochica-login-"));
  store = new CredentialStore(join(dir, "credentials.json"), encryptor, {});
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const service = (login: typeof pkceLogin) => new LoginService(store, async () => {}, logger, login);

describe("LoginService", () => {
  test("saves the key the provider gives as a new key", async () => {
    store.add("openrouter", "sk-or-v1-pasted-0000", "Key 1");
    const result = await service(async () => "sk-or-v1-from-sign-in-1111").start(request);

    expect(result).toEqual({ status: "ok" });
    expect(store.list().map((c) => c.label)).toEqual(["Key 1", "OpenRouter sign-in"]);
    expect(
      store
        .pool("openrouter")
        ?.keys()
        .map((k) => k.key),
    ).toEqual(["sk-or-v1-pasted-0000", "sk-or-v1-from-sign-in-1111"]);
  });

  test("a failed sign-in saves nothing and says why", async () => {
    const result = await service(async () => {
      throw new LoginError("denied");
    }).start(request);
    expect(result).toEqual({ status: "denied" });
    expect(store.list()).toEqual([]);
  });

  test("one sign-in at a time; Cancel ends the one waiting", async () => {
    const logins = service(
      ({ signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new LoginError("cancelled"))),
        ),
    );
    const first = logins.start(request);
    expect(await logins.start(request)).toEqual({ status: "busy" });
    logins.cancel();
    expect(await first).toEqual({ status: "cancelled" });
  });

  test("a provider without a sign-in is refused", async () => {
    await expect(
      service(async () => "x").start({ ...request, provider: "anthropic" }),
    ).rejects.toThrow("no sign-in");
  });
});
