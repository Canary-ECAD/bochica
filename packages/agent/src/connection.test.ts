import { describe, expect, test } from "bun:test";
import { testConnection } from "./connection";
import { getProvider } from "./providers";

const respondWith = (status: number): typeof fetch =>
  Object.assign(async () => new Response(null, { status }), { preconnect: () => {} });

describe("testConnection", () => {
  const anthropic = getProvider("anthropic");

  test("2xx means the key works", async () => {
    expect(await testConnection(anthropic, "k", respondWith(200))).toEqual({ status: "ok" });
  });

  test.each([401, 403])("%i means the key was rejected", async (status) => {
    expect(await testConnection(anthropic, "k", respondWith(status))).toEqual({
      status: "invalid",
    });
  });

  test("other statuses are reported with their code", async () => {
    expect(await testConnection(anthropic, "k", respondWith(529))).toEqual({
      status: "error",
      httpStatus: 529,
    });
  });

  test("a failed request is a network error", async () => {
    const failing = Object.assign(
      async (): Promise<Response> => {
        throw new TypeError("fetch failed");
      },
      { preconnect: () => {} },
    );
    expect(await testConnection(anthropic, "k", failing)).toEqual({ status: "network_error" });
  });

  test("sends the key the way the provider expects", async () => {
    let seen: RequestInit["headers"];
    const capture = Object.assign(
      async (_url: string | URL | Request, init?: RequestInit) => {
        seen = init?.headers;
        return new Response(null, { status: 200 });
      },
      { preconnect: () => {} },
    );
    await testConnection(getProvider("openai"), "abc", capture);
    expect(seen).toEqual({ Authorization: "Bearer abc" });
  });
});
