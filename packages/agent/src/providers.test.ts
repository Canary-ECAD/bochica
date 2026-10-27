import { describe, expect, test } from "bun:test";
import { getProvider, providerIds, providers } from "./providers";

describe("providers", () => {
  test("ids are unique", () => {
    const ids = providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every api_key provider links to where the key is created", () => {
    for (const p of providers.filter((entry) => entry.auth === "api_key")) {
      expect(p.keyUrl).toStartWith("https://");
    }
  });

  test("local providers point at this machine", () => {
    for (const p of providers.filter((entry) => entry.auth === "local")) {
      expect(p.baseUrl).toStartWith("http://127.0.0.1:");
    }
  });

  test("the catalog covers every provider id", () => {
    expect(providers.map((p) => p.id).toSorted()).toEqual([...providerIds].toSorted());
  });

  test("checks use HTTPS except for local servers", () => {
    for (const p of providers) {
      expect(p.check.url).toStartWith(p.auth === "local" ? "http://127.0.0.1:" : "https://");
    }
  });

  test("getProvider returns the matching entry", () => {
    expect(getProvider("anthropic").label).toBe("Anthropic");
  });
});
