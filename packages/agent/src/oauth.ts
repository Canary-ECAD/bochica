import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ProviderLogin } from "./providers";

// Browser sign-in for providers that give an API key through OAuth PKCE (OpenRouter). The
// redirect comes back to a server on 127.0.0.1 with an ephemeral port. OpenRouter echoes no
// `state`, so a random nonce rides in the callback path: a request to any other path is a 404
// and never reaches the exchange.

const LOGIN_TIMEOUT_MS = 5 * 60_000;
const EXCHANGE_TIMEOUT_MS = 20_000;

/** Why a sign-in ended without a key. */
export type LoginFailure = "denied" | "timeout" | "cancelled" | "failed";

export class LoginError extends Error {
  constructor(readonly reason: LoginFailure) {
    super(`Sign-in ${reason}`);
  }
}

export interface LoginOptions {
  login: ProviderLogin;
  /** Opens the system browser on the sign-in page. */
  openBrowser: (url: string) => void | Promise<void>;
  /** What the browser tab says once the redirect arrived, in the user's language. */
  page: { done: string; failed: string };
  signal: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Runs the sign-in and returns the provider's API key. Throws `LoginError`. */
export async function pkceLogin(options: LoginOptions): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const path = `/callback/${randomBytes(16).toString("base64url")}`;

  const callback = Promise.withResolvers<URLSearchParams>();
  // A timeout or cancel can come while the browser is still opening, before anyone awaits.
  callback.promise.catch(() => {});
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== path) {
      response.writeHead(404).end();
      return;
    }
    const ok = url.searchParams.has("code") && !url.searchParams.has("error");
    response
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8", Connection: "close" })
      .end(resultPage(ok ? options.page.done : options.page.failed));
    callback.resolve(url.searchParams);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => callback.reject(new LoginError("cancelled"));
  try {
    const port = await listen(server);
    const authorize = new URL(options.login.authorizeUrl);
    authorize.searchParams.set("callback_url", `http://127.0.0.1:${port}${path}`);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");

    if (options.signal.aborted) throw new LoginError("cancelled");
    options.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(
      () => callback.reject(new LoginError("timeout")),
      options.timeoutMs ?? LOGIN_TIMEOUT_MS,
    );
    await options.openBrowser(authorize.toString());

    const params = await callback.promise;
    const code = params.get("code");
    if (params.has("error") || !code) throw new LoginError("denied");
    return await exchange(options, code, verifier);
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", onAbort);
    server.closeAllConnections();
    server.close();
  }
}

async function exchange(options: LoginOptions, code: string, verifier: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);
  const cancel = () => controller.abort();
  options.signal.addEventListener("abort", cancel, { once: true });
  try {
    const response = await (options.fetchImpl ?? fetch)(options.login.exchangeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      signal: controller.signal,
    });
    if (!response.ok) throw new LoginError("failed");
    const body: unknown = await response.json();
    const key =
      typeof body === "object" && body !== null && "key" in body && typeof body.key === "string"
        ? body.key.trim()
        : "";
    if (!key) throw new LoginError("failed");
    return key;
  } catch (error) {
    if (error instanceof LoginError) throw error;
    throw new LoginError(options.signal.aborted ? "cancelled" : "failed");
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", cancel);
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", () => reject(new LoginError("failed")));
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function resultPage(message: string): string {
  const text = message.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bochica</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0"><p style="font-size:1.1rem;max-width:32rem;text-align:center">${text}</p></body></html>`;
}
