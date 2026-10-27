// Masks credentials before text reaches logs, the model or the UI. Patterns are deliberately
// broad: a false positive costs a few unreadable characters, a false negative leaks a key.

const REDACTED = "[REDACTED]";

const patterns: readonly RegExp[] = [
  // Anthropic, OpenAI (incl. project keys) and OpenRouter keys.
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  // Google API keys.
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // GitHub tokens.
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  // Authorization headers.
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
];

// `api_key=…`, `token: …`, `"password": "…"`: keep the name, mask the value.
const namedValue =
  /\b([A-Za-z_-]*(?:key|token|password|secret)[A-Za-z_-]*)("?\s*[:=]\s*"?)([^\s"'&,;]{4,})/gi;

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of patterns) result = result.replace(pattern, REDACTED);
  return result.replace(namedValue, (match, name: string, separator: string, value: string) =>
    value === REDACTED ? match : `${name}${separator}${REDACTED}`,
  );
}

/** Short preview of a key for display, e.g. `sk-ant-…a1b2`. Never enough to use the key. */
export function maskSecret(secret: string): string {
  if (secret.length < 16) return "••••";
  return `${secret.slice(0, 7)}…${secret.slice(-4)}`;
}
