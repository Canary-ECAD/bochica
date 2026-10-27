import type { ConnectionResult } from "@bochica/shared";
import type { Provider } from "./providers";

const TIMEOUT_MS = 10_000;

/** Proves that a key (or a local server) works with one cheap request. Never throws. */
export async function testConnection(
  provider: Provider,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionResult> {
  let response: Response;
  try {
    response = await fetchImpl(provider.check.url, {
      headers: provider.check.headers(key),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { status: "network_error" };
  }
  if (response.ok) return { status: "ok" };
  if (response.status === 401 || response.status === 403) return { status: "invalid" };
  return { status: "error", httpStatus: response.status };
}
