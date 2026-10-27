import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  AppInfo,
  ConnectionResult,
  CredentialList,
  ModelList,
  SetCredentialRequest,
  TurnEvent,
} from "./ipc";

describe("AppInfo", () => {
  test("accepts a valid payload", () => {
    const info = { name: "Bochica", version: "0.1.0", platform: "win32" };
    expect(AppInfo.parse(info)).toEqual(info);
  });

  test("rejects a payload with missing fields", () => {
    expect(AppInfo.safeParse({ name: "Bochica" }).success).toBe(false);
  });
});

/** Every property name reachable in a schema, through objects, arrays and unions. */
function fieldNames(schema: z.ZodType): string[] {
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape as Record<string, z.ZodType>).flatMap(([name, child]) => [
      name,
      ...fieldNames(child),
    ]);
  }
  if (schema instanceof z.ZodArray) return fieldNames(schema.element as z.ZodType);
  if (schema instanceof z.ZodUnion)
    return schema.options.flatMap((o) => fieldNames(o as z.ZodType));
  return [];
}

describe("credential responses", () => {
  const responses = { CredentialList, ConnectionResult, AppInfo, ModelList, TurnEvent };
  const forbidden = new Set(["secret", "key", "apikey", "token", "value", "password"]);

  test.each(Object.entries(responses))("%s has no field that could carry a key", (_, schema) => {
    const names = fieldNames(schema).map((n) => n.toLowerCase());
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => forbidden.has(n))).toEqual([]);
  });
});

describe("SetCredentialRequest", () => {
  test("trims the key", () => {
    const parsed = SetCredentialRequest.parse({ provider: "openai", secret: "  sk-abcdefgh  " });
    expect(parsed.secret).toBe("sk-abcdefgh");
  });

  test("rejects an unknown provider and an empty key", () => {
    expect(
      SetCredentialRequest.safeParse({ provider: "acme", secret: "sk-abcdefgh" }).success,
    ).toBe(false);
    expect(SetCredentialRequest.safeParse({ provider: "openai", secret: "   " }).success).toBe(
      false,
    );
  });
});
