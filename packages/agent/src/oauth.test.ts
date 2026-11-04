import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { LoginError, type LoginFailure, type LoginOptions, pkceLogin } from "./oauth";

const page = { done: "Signed in. <You can close this tab>", failed: "Sign-in failed." };
const KEY = "sk-or-v1-made-up-key-0123456789";

/** A stand-in for OpenRouter's exchange endpoint that checks the PKCE pair. */
function fakeProvider(answer?: (challenge: string, verifier: string) => Response) {
  let challenge = "";
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const body = (await request.json()) as { code: string; code_verifier: string };
      const computed = createHash("sha256").update(body.code_verifier).digest("base64url");
      if (answer) return answer(challenge, body.code_verifier);
      if (body.code !== "good-code" || computed !== challenge) {
        return new Response("forbidden", { status: 403 });
      }
      return Response.json({ key: KEY, user_id: "user-1" });
    },
  });
  servers.push(server);
  return {
    login: { authorizeUrl: "https://auth.example.test/auth", exchangeUrl: server.url.href },
    remember: (authUrl: string) => {
      challenge = new URL(authUrl).searchParams.get("code_challenge") ?? "";
    },
  };
}

const servers: Array<{ stop(force?: boolean): unknown }> = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** Plays the browser: reads the callback from the sign-in URL and visits it. */
function browser(
  remember: (url: string) => void,
  visit: (callback: URL) => Promise<void>,
): LoginOptions["openBrowser"] {
  return (url) => {
    remember(url);
    const callback = new URL(new URL(url).searchParams.get("callback_url") ?? "");
    void visit(callback);
  };
}

async function failure(run: Promise<string>): Promise<LoginFailure | string> {
  try {
    return `key:${await run}`;
  } catch (error) {
    return error instanceof LoginError ? error.reason : String(error);
  }
}

describe("pkceLogin", () => {
  test("gets the key through the loopback redirect", async () => {
    const provider = fakeProvider();
    const shown = Promise.withResolvers<string>();
    let opened = "";
    const key = await pkceLogin({
      login: provider.login,
      page,
      signal: new AbortController().signal,
      openBrowser: browser(
        (url) => {
          opened = url;
          provider.remember(url);
        },
        async (callback) => {
          callback.searchParams.set("code", "good-code");
          shown.resolve(await (await fetch(callback)).text());
        },
      ),
    });

    expect(key).toBe(KEY);
    const params = new URL(opened).searchParams;
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("callback_url")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback\/[\w-]{20,}$/);
    // The page escapes what it shows.
    expect(await shown.promise).toContain("Signed in. &#60;You can close this tab&#62;");
  });

  test("a request to another path is a 404 and changes nothing", async () => {
    const provider = fakeProvider();
    let wrongPath = 0;
    const key = await pkceLogin({
      login: provider.login,
      page,
      signal: new AbortController().signal,
      openBrowser: browser(provider.remember, async (callback) => {
        const other = new URL(callback);
        other.pathname = "/callback/guessed";
        other.searchParams.set("code", "evil-code");
        wrongPath = (await fetch(other)).status;
        callback.searchParams.set("code", "good-code");
        await fetch(callback);
      }),
    });
    expect(wrongPath).toBe(404);
    expect(key).toBe(KEY);
  });

  test("the user saying no is `denied`", async () => {
    const provider = fakeProvider();
    const shown = Promise.withResolvers<string>();
    const result = await failure(
      pkceLogin({
        login: provider.login,
        page,
        signal: new AbortController().signal,
        openBrowser: browser(provider.remember, async (callback) => {
          callback.searchParams.set("error", "access_denied");
          shown.resolve(await (await fetch(callback)).text());
        }),
      }),
    );
    expect(result).toBe("denied");
    expect(await shown.promise).toContain("Sign-in failed.");
  });

  test("a refused exchange is `failed`, and the key never shows in an error", async () => {
    const provider = fakeProvider(() => new Response(`no ${KEY}`, { status: 403 }));
    const result = await failure(
      pkceLogin({
        login: provider.login,
        page,
        signal: new AbortController().signal,
        openBrowser: browser(provider.remember, async (callback) => {
          callback.searchParams.set("code", "good-code");
          await fetch(callback);
        }),
      }),
    );
    expect(result).toBe("failed");
    expect(result).not.toContain(KEY);
  });

  test("an answer without a key is `failed`", async () => {
    const provider = fakeProvider(() => Response.json({ user_id: "user-1" }));
    const result = await failure(
      pkceLogin({
        login: provider.login,
        page,
        signal: new AbortController().signal,
        openBrowser: browser(provider.remember, async (callback) => {
          callback.searchParams.set("code", "good-code");
          await fetch(callback);
        }),
      }),
    );
    expect(result).toBe("failed");
  });

  test("no redirect in time is `timeout`", async () => {
    const provider = fakeProvider();
    const result = await failure(
      pkceLogin({
        login: provider.login,
        page,
        signal: new AbortController().signal,
        timeoutMs: 50,
        openBrowser: () => {},
      }),
    );
    expect(result).toBe("timeout");
  });

  test("Cancel stops the wait and closes the loopback server", async () => {
    const provider = fakeProvider();
    const controller = new AbortController();
    let callback: URL | undefined;
    const run = failure(
      pkceLogin({
        login: provider.login,
        page,
        signal: controller.signal,
        openBrowser: (url) => {
          callback = new URL(new URL(url).searchParams.get("callback_url") ?? "");
          setTimeout(() => controller.abort(), 10);
        },
      }),
    );
    expect(await run).toBe("cancelled");
    const after = await fetch(callback ?? "http://127.0.0.1:1/").then(
      () => "answered",
      () => "closed",
    );
    expect(after).toBe("closed");
  });
});
