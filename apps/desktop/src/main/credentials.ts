import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  getProvider,
  type KeyOutcome,
  type KeyPool,
  maskSecret,
  type PooledKey,
  providers,
} from "@bochica/agent";
import { type CredentialInfo, ProviderId } from "@bochica/shared";
import { z } from "zod";

/** Electron's safeStorage (DPAPI on Windows), injected so the store can be tested without it. */
export interface Encryptor {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const StoredCredential = z.object({
  id: z.string(),
  provider: ProviderId,
  kind: z.literal("api_key"),
  label: z.string(),
  priority: z.number().int(),
  status: z.enum(["unknown", "ok", "invalid"]),
  preview: z.string(),
  /** base64 of the encrypted key. */
  secret: z.string(),
});
type StoredCredential = z.infer<typeof StoredCredential>;

const StoreFile = z.object({ version: z.literal(1), credentials: z.array(StoredCredential) });

type Status = CredentialInfo["status"];

/** How long a key sits out after the provider limited it, or said its balance is empty. */
export const RATE_LIMIT_PAUSE_MS = 60_000;
export const QUOTA_PAUSE_MS = 60 * 60_000;

/**
 * API keys, owned by the main process: several per provider, in the order the user chose. Keys
 * saved in the app are encrypted on disk; keys found in environment variables follow them,
 * read-only. The renderer only ever sees `list()`.
 */
export class CredentialStore {
  private credentials: StoredCredential[];
  /** Status of environment keys, which are not persisted. */
  private readonly envStatus = new Map<string, Status>();
  /** Keys paused after a rate limit or an empty balance, until a time. Memory only. */
  private readonly pausedUntil = new Map<string, number>();

  constructor(
    private readonly file: string,
    private readonly encryptor: Encryptor,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly now: () => number = Date.now,
  ) {
    this.credentials = this.load();
  }

  /** Every key, providers' app keys in their order, then environment keys. */
  list(): CredentialInfo[] {
    const saved = this.ordered().map(({ secret: _secret, ...info }) => ({
      ...info,
      source: "app" as const,
      ...this.limit(info.id),
    }));
    const fromEnv = providers.flatMap((provider) =>
      provider.envVars
        .filter((name) => this.env[name])
        .map((name) => ({
          id: `env:${name}`,
          provider: provider.id,
          kind: "api_key" as const,
          label: name,
          source: "env" as const,
          priority: 100,
          status: this.envStatus.get(`env:${name}`) ?? ("unknown" as const),
          preview: name,
          ...this.limit(`env:${name}`),
        })),
    );
    return [...saved, ...fromEnv];
  }

  /** Adds a key after the provider's other app keys. Returns its id. */
  add(provider: ProviderId, secret: string, label: string): string {
    if (!this.encryptor.isEncryptionAvailable()) {
      throw new Error("Windows secure storage is not available; the key was not saved.");
    }
    const mine = this.credentials.filter((c) => c.provider === provider);
    const credential: StoredCredential = {
      id: randomUUID(),
      provider,
      kind: "api_key",
      label,
      priority: Math.max(-1, ...mine.map((c) => c.priority)) + 1,
      status: "unknown",
      preview: maskSecret(secret),
      secret: this.encryptor.encryptString(secret).toString("base64"),
    };
    this.credentials = [...this.credentials, credential];
    this.persist();
    return credential.id;
  }

  /** Renames a key, or moves it to `position` among its provider's app keys (0 = first). */
  update(id: string, change: { label?: string | undefined; position?: number | undefined }): void {
    const credential = this.credentials.find((c) => c.id === id);
    if (!credential)
      throw new Error("This key no longer exists, or it comes from the environment.");
    if (change.label !== undefined) credential.label = change.label;
    if (change.position !== undefined) {
      const others = this.ordered().filter(
        (c) => c.provider === credential.provider && c.id !== id,
      );
      const at = Math.min(Math.max(0, change.position), others.length);
      [...others.slice(0, at), credential, ...others.slice(at)].forEach((c, index) => {
        c.priority = index;
      });
    }
    this.persist();
  }

  remove(id: string): void {
    if (id.startsWith("env:")) {
      throw new Error("Keys from environment variables can't be removed from the app.");
    }
    this.credentials = this.credentials.filter((c) => c.id !== id);
    this.pausedUntil.delete(id);
    this.persist();
  }

  /**
   * The key to call a provider with: the given one, or the first that isn't paused (the first
   * of all when every key is). Undefined when the provider has no key.
   */
  resolve(provider: ProviderId, id?: string): string | undefined {
    return this.inUse(provider, id)?.key;
  }

  /** Like `resolve`, with the key's id, for recording what a test found. */
  inUse(provider: ProviderId, id?: string): PooledKey | undefined {
    const keys = this.keys(provider);
    return id === undefined
      ? (keys.find((k) => !k.paused) ?? keys[0])
      : keys.find((k) => k.id === id);
  }

  /** The provider's keys for a model, which reports back how each call went. */
  pool(provider: ProviderId): KeyPool | undefined {
    if (this.keys(provider).length === 0) return undefined;
    return {
      keys: () => this.keys(provider),
      report: (id, outcome) => this.report(id, outcome),
    };
  }

  report(id: string, outcome: KeyOutcome): void {
    if (outcome === "rate_limit" || outcome === "quota") {
      const pause = outcome === "quota" ? QUOTA_PAUSE_MS : RATE_LIMIT_PAUSE_MS;
      this.pausedUntil.set(id, this.now() + pause);
      return;
    }
    this.pausedUntil.delete(id);
    this.setStatus(id, outcome);
  }

  /** Records the result of a connection test, or of a model call. */
  setStatus(id: string, status: Status): void {
    if (id.startsWith("env:")) {
      this.envStatus.set(id, status);
      return;
    }
    const saved = this.credentials.find((c) => c.id === id);
    if (!saved || saved.status === status) return;
    saved.status = status;
    this.persist();
  }

  /** Decrypted keys of a provider in use order; only for the model and connection tests. */
  private keys(provider: ProviderId): PooledKey[] {
    const saved = this.ordered()
      .filter((c) => c.provider === provider)
      .map((c) => ({
        id: c.id,
        key: this.encryptor.decryptString(Buffer.from(c.secret, "base64")),
        paused: c.status === "invalid" || this.limit(c.id).limitedUntil !== undefined,
      }));
    const fromEnv = getProvider(provider).envVars.flatMap((name) => {
      const key = this.env[name];
      if (!key) return [];
      const id = `env:${name}`;
      const paused =
        this.envStatus.get(id) === "invalid" || this.limit(id).limitedUntil !== undefined;
      return [{ id, key, paused }];
    });
    return [...saved, ...fromEnv];
  }

  private ordered(): StoredCredential[] {
    return this.credentials.toSorted((a, b) => a.priority - b.priority);
  }

  private limit(id: string): { limitedUntil?: number } {
    const until = this.pausedUntil.get(id);
    return until !== undefined && until > this.now() ? { limitedUntil: until } : {};
  }

  private load(): StoredCredential[] {
    if (!existsSync(this.file)) return [];
    const parsed = StoreFile.safeParse(safeJson(readFileSync(this.file, "utf8")));
    if (parsed.success) return parsed.data.credentials;
    // Keep the unreadable file for diagnosis instead of overwriting it.
    renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
    return [];
  }

  /** Atomic: a crash mid-write leaves the previous file intact. */
  private persist(): void {
    const data: z.infer<typeof StoreFile> = { version: 1, credentials: this.credentials };
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
