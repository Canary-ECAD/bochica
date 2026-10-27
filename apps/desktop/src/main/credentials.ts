import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { getProvider, maskSecret, providers } from "@bochica/agent";
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

/**
 * API keys, owned by the main process. Keys saved in the app are encrypted on disk; keys found
 * in environment variables are listed read-only. The renderer only ever sees `list()`.
 */
export class CredentialStore {
  private credentials: StoredCredential[];
  /** Status of environment keys, which are not persisted. */
  private readonly envStatus = new Map<string, Status>();

  constructor(
    private readonly file: string,
    private readonly encryptor: Encryptor,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {
    this.credentials = this.load();
  }

  list(): CredentialInfo[] {
    const saved = this.credentials.map(({ secret: _secret, ...info }) => ({
      ...info,
      source: "app" as const,
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
        })),
    );
    return [...saved, ...fromEnv];
  }

  /** Saves the app key for a provider, replacing any previous one. */
  save(provider: ProviderId, secret: string): void {
    if (!this.encryptor.isEncryptionAvailable()) {
      throw new Error("Windows secure storage is not available; the key was not saved.");
    }
    const existing = this.credentials.find((c) => c.provider === provider);
    const credential: StoredCredential = {
      id: existing?.id ?? randomUUID(),
      provider,
      kind: "api_key",
      label: getProvider(provider).label,
      priority: 0,
      status: "unknown",
      preview: maskSecret(secret),
      secret: this.encryptor.encryptString(secret).toString("base64"),
    };
    this.credentials = [...this.credentials.filter((c) => c.provider !== provider), credential];
    this.persist();
  }

  remove(id: string): void {
    if (id.startsWith("env:")) {
      throw new Error("Keys from environment variables can't be removed from the app.");
    }
    this.credentials = this.credentials.filter((c) => c.id !== id);
    this.persist();
  }

  /** The key to use for a provider: the app key first, then environment variables. */
  resolve(provider: ProviderId): string | undefined {
    const saved = this.credentials.find((c) => c.provider === provider);
    if (saved) return this.encryptor.decryptString(Buffer.from(saved.secret, "base64"));
    const name = getProvider(provider).envVars.find((n) => this.env[n]);
    return name ? this.env[name] : undefined;
  }

  /** Records the result of a connection test on whichever key `resolve` would use. */
  setStatus(provider: ProviderId, status: Status): void {
    const saved = this.credentials.find((c) => c.provider === provider);
    if (saved) {
      saved.status = status;
      this.persist();
      return;
    }
    const name = getProvider(provider).envVars.find((n) => this.env[n]);
    if (name) this.envStatus.set(`env:${name}`, status);
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
