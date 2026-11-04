import type { ConnectionResult } from "@bochica/shared";
import type { Provider } from "./providers";

const TIMEOUT_MS = 10_000;

/**
 * Proves that a key (or a local server) works with one cheap request. Never throws, except for
 * a provider without an HTTP check (Claude Agent), which main tests another way.
 */
export async function testConnection(
  provider: Provider,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionResult> {
  const { check } = provider;
  if (!check) throw new Error(`${provider.label} is not tested over HTTP.`);
  let response: Response;
  try {
    response = await fetchImpl(check.url, {
      headers: check.headers(key),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { status: "network_error" };
  }
  if (response.ok) return { status: "ok" };
  if (response.status === 401 || response.status === 403) return { status: "invalid" };
  return { status: "error", httpStatus: response.status };
}
