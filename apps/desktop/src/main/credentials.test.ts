import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialStore, type Encryptor } from "./credentials";

// Reversible stand-in for safeStorage: enough to prove the file never holds the key in clear.
const fakeEncryptor: Encryptor = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from([...plain].toReversed().join(""), "utf8"),
  decryptString: (data) => [...data.toString("utf8")].toReversed().join(""),
};

const key = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz";
let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bochica-cred-"));
  file = join(dir, "credentials.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("CredentialStore", () => {
  test("saves, survives a restart and resolves the key", () => {
    new CredentialStore(file, fakeEncryptor, {}).save("anthropic", key);

    const reopened = new CredentialStore(file, fakeEncryptor, {});
    expect(reopened.resolve("anthropic")).toBe(key);
    expect(reopened.list()).toMatchObject([
      { provider: "anthropic", source: "app", preview: "sk-ant-…WxYz", status: "unknown" },
    ]);
  });

  test("never writes the key in clear and never lists it", () => {
    const store = new CredentialStore(file, fakeEncryptor, {});
    store.save("anthropic", key);
    expect(readFileSync(file, "utf8")).not.toContain(key);
    expect(JSON.stringify(store.list())).not.toContain(key);
  });

  test("saving again replaces the provider's key", () => {
    const store = new CredentialStore(file, fakeEncryptor, {});
    store.save("openai", "sk-proj-first-key-0000");
    store.save("openai", "sk-proj-second-key-1111");
    expect(store.list()).toHaveLength(1);
    expect(store.resolve("openai")).toBe("sk-proj-second-key-1111");
  });

  test("removes a key", () => {
    const store = new CredentialStore(file, fakeEncryptor, {});
    store.save("openai", "sk-proj-first-key-0000");
    const [saved] = store.list();
    store.remove(saved?.id ?? "");
    expect(store.list()).toEqual([]);
    expect(store.resolve("openai")).toBeUndefined();
  });

  test("lists environment keys read-only and uses them as a fallback", () => {
    const store = new CredentialStore(file, fakeEncryptor, { OPENAI_API_KEY: "sk-env-key-abcdef" });
    expect(store.list()).toMatchObject([
      { id: "env:OPENAI_API_KEY", provider: "openai", source: "env", preview: "OPENAI_API_KEY" },
    ]);
    expect(store.resolve("openai")).toBe("sk-env-key-abcdef");
    expect(() => store.remove("env:OPENAI_API_KEY")).toThrow();
  });

  test("an app key wins over an environment key", () => {
    const store = new CredentialStore(file, fakeEncryptor, { OPENAI_API_KEY: "sk-env-key-abcdef" });
    store.save("openai", "sk-proj-app-key-0000");
    expect(store.resolve("openai")).toBe("sk-proj-app-key-0000");
  });

  test("records test results", () => {
    const store = new CredentialStore(file, fakeEncryptor, { GEMINI_API_KEY: "AIza-env" });
    store.save("anthropic", key);
    store.setStatus("anthropic", "ok");
    store.setStatus("google", "invalid");
    const byProvider = Object.fromEntries(store.list().map((c) => [c.provider, c.status]));
    expect(byProvider).toEqual({ anthropic: "ok", google: "invalid" });
  });

  test("writes atomically, leaving no temp file behind", () => {
    new CredentialStore(file, fakeEncryptor, {}).save("anthropic", key);
    expect(readdirSync(dir)).toEqual(["credentials.json"]);
  });

  test("a corrupt file is set aside instead of crashing", () => {
    writeFileSync(file, "{ not json");
    const store = new CredentialStore(file, fakeEncryptor, {});
    expect(store.list()).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir).some((name) => name.startsWith("credentials.json.corrupt-"))).toBe(
      true,
    );
  });

  test("refuses to save when secure storage is unavailable", () => {
    const store = new CredentialStore(
      file,
      { ...fakeEncryptor, isEncryptionAvailable: () => false },
      {},
    );
    expect(() => store.save("anthropic", key)).toThrow(/secure storage/);
    expect(existsSync(file)).toBe(false);
  });
});
