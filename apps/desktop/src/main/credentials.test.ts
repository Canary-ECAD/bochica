import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CredentialStore,
  type Encryptor,
  QUOTA_PAUSE_MS,
  RATE_LIMIT_PAUSE_MS,
} from "./credentials";

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
    new CredentialStore(file, fakeEncryptor, {}).add("anthropic", key, "Work");

    const reopened = new CredentialStore(file, fakeEncryptor, {});
    expect(reopened.resolve("anthropic")).toBe(key);
    expect(reopened.list()).toMatchObject([
      {
        provider: "anthropic",
        source: "app",
        label: "Work",
        preview: "sk-ant-…WxYz",
        status: "unknown",
      },
    ]);
  });

  test("never writes the key in clear and never lists it", () => {
    const store = new CredentialStore(file, fakeEncryptor, {});
    store.add("anthropic", key, "Work");
    expect(readFileSync(file, "utf8")).not.toContain(key);
    expect(JSON.stringify(store.list())).not.toContain(key);
  });

  test("reads a file from an earlier version, one key per provider", () => {
    const old = {
      version: 1,
      credentials: [
        {
          id: "old",
          provider: "openai",
          kind: "api_key",
          label: "OpenAI",
          priority: 0,
          status: "ok",
          preview: "sk-p…0000",
          secret: fakeEncryptor.encryptString("sk-proj-old-key-0000").toString("base64"),
        },
      ],
    };
    writeFileSync(file, JSON.stringify(old));
    const store = new CredentialStore(file, fakeEncryptor, {});
    expect(store.resolve("openai")).toBe("sk-proj-old-key-0000");
    store.add("openai", "sk-proj-new-key-1111", "Key 2");
    expect(store.list().map((c) => c.label)).toEqual(["OpenAI", "Key 2"]);
  });

  test("adds keys in order, renames and moves them", () => {
    const store = new CredentialStore(file, fakeEncryptor, {});
    const first = store.add("openai", "sk-proj-first-key-0000", "First");
    store.add("anthropic", key, "Other provider");
    const second = store.add("openai", "sk-proj-second-key-1111", "Second");
    const third = store.add("openai", "sk-proj-third-key-2222", "Third");
    const labels = () =>
      store
        .list()
        .filter((c) => c.provider === "openai")
        .map((c) => c.label);
    expect(labels()).toEqual(["First", "Second", "Third"]);
    expect(store.resolve("openai")).toBe("sk-proj-first-key-0000");

    store.update(third, { position: 0 });
    expect(labels()).toEqual(["Third", "First", "Second"]);
    store.update(third, { position: 99 });
    expect(labels()).toEqual(["First", "Second", "Third"]);
    store.update(second, { label: "Personal" });
    expect(labels()).toEqual(["First", "Personal", "Third"]);
    expect(store.resolve("openai", second)).toBe("sk-proj-second-key-1111");

    const reopened = new CredentialStore(file, fakeEncryptor, {});
    expect(
      reopened
        .list()
        .filter((c) => c.provider === "openai")
        .map((c) => c.label),
    ).toEqual(["First", "Personal", "Third"]);
    expect(() => store.update("env:OPENAI_API_KEY", { label: "x" })).toThrow();
    expect(store.resolve("openai", first)).toBe("sk-proj-first-key-0000");
  });

  test("removes a key", () => {
    const store = new CredentialStore(file, fakeEncryptor, {});
    const id = store.add("openai", "sk-proj-first-key-0000", "Key 1");
    store.remove(id);
    expect(store.list()).toEqual([]);
    expect(store.resolve("openai")).toBeUndefined();
    expect(store.pool("openai")).toBeUndefined();
  });

  test("lists environment keys read-only, after the app keys", () => {
    const store = new CredentialStore(file, fakeEncryptor, { OPENAI_API_KEY: "sk-env-key-abcdef" });
    expect(store.list()).toMatchObject([
      { id: "env:OPENAI_API_KEY", provider: "openai", source: "env", preview: "OPENAI_API_KEY" },
    ]);
    expect(store.resolve("openai")).toBe("sk-env-key-abcdef");
    expect(() => store.remove("env:OPENAI_API_KEY")).toThrow();

    store.add("openai", "sk-proj-app-key-0000", "Key 1");
    expect(store.resolve("openai")).toBe("sk-proj-app-key-0000");
    expect(
      store
        .pool("openai")
        ?.keys()
        .map((k) => k.id),
    ).toEqual([expect.any(String), "env:OPENAI_API_KEY"]);
  });

  test("records test results per key", () => {
    const store = new CredentialStore(file, fakeEncryptor, { GEMINI_API_KEY: "AIza-env" });
    const id = store.add("anthropic", key, "Key 1");
    store.setStatus(id, "ok");
    store.setStatus("env:GEMINI_API_KEY", "invalid");
    const byProvider = Object.fromEntries(store.list().map((c) => [c.provider, c.status]));
    expect(byProvider).toEqual({ anthropic: "ok", google: "invalid" });
  });

  test("the pool skips rejected and paused keys until they work again", () => {
    let now = 1_000_000;
    const store = new CredentialStore(file, fakeEncryptor, {}, () => now);
    const a = store.add("openrouter", "sk-or-v1-aaaaaaaa", "A");
    const b = store.add("openrouter", "sk-or-v1-bbbbbbbb", "B");
    const c = store.add("openrouter", "sk-or-v1-cccccccc", "C");
    const pool = store.pool("openrouter");
    const paused = () =>
      pool
        ?.keys()
        .filter((k) => k.paused)
        .map((k) => k.id);

    pool?.report(a, "invalid");
    pool?.report(b, "rate_limit");
    pool?.report(c, "quota");
    expect(paused()).toEqual([a, b, c]);
    expect(store.list().find((k) => k.id === b)?.limitedUntil).toBe(now + RATE_LIMIT_PAUSE_MS);
    // With every key paused, the first one is still the one to try.
    expect(store.resolve("openrouter")).toBe("sk-or-v1-aaaaaaaa");

    now += RATE_LIMIT_PAUSE_MS + 1;
    expect(paused()).toEqual([a, c]);
    expect(store.resolve("openrouter")).toBe("sk-or-v1-bbbbbbbb");
    now += QUOTA_PAUSE_MS;
    expect(paused()).toEqual([a]);
    expect(store.list().every((k) => k.limitedUntil === undefined)).toBe(true);

    pool?.report(a, "ok");
    expect(paused()).toEqual([]);
    // The rejection was saved; the pauses were not.
    pool?.report(b, "invalid");
    pool?.report(c, "quota");
    const reopened = new CredentialStore(file, fakeEncryptor, {}, () => now);
    expect(
      reopened
        .pool("openrouter")
        ?.keys()
        .filter((k) => k.paused)
        .map((k) => k.id),
    ).toEqual([b]);
  });

  test("writes atomically, leaving no temp file behind", () => {
    new CredentialStore(file, fakeEncryptor, {}).add("anthropic", key, "Key 1");
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
    expect(() => store.add("anthropic", key, "Key 1")).toThrow(/secure storage/);
    expect(existsSync(file)).toBe(false);
  });
});
