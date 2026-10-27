import { describe, expect, test } from "bun:test";
import { maskSecret, redactSecrets } from "./redact";

// Fake credentials: right shape, never real.
const anthropic = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const openai = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWx";
const openrouter = "sk-or-v1-0123456789abcdef0123456789abcdef";
const google = "AIzaSyA-1234567890abcdefghijklmnopqrstu";
const github = "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345";

describe("redactSecrets", () => {
  test.each([
    ["Anthropic key", `key is ${anthropic} ok`, "key is [REDACTED] ok"],
    ["OpenAI key", `using ${openai}`, "using [REDACTED]"],
    ["OpenRouter key", `${openrouter}`, "[REDACTED]"],
    ["Google key", `google=${google}`, "google=[REDACTED]"],
    ["GitHub token", `token ${github}`, "token [REDACTED]"],
    ["Bearer header", "Authorization: Bearer abc.def-ghi_123", "Authorization: [REDACTED]"],
    ["api_key pair", "url?api_key=s3cr3tvalue&x=1", "url?api_key=[REDACTED]&x=1"],
    ["JSON password", '{"password": "hunter22"}', '{"password": "[REDACTED]"}'],
    ["env assignment", "OPENAI_API_KEY=abcd1234efgh", "OPENAI_API_KEY=[REDACTED]"],
  ])("masks %s", (_name, input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  test.each([
    "Opened project Demo.elk with 12 pages",
    "skip-this-step is not a key",
    "The keyboard layout changed",
    "monkey business",
    "C:\\Users\\Public\\Documents",
  ])("leaves ordinary text untouched: %s", (input) => {
    expect(redactSecrets(input)).toBe(input);
  });

  test("the secret never survives in the output", () => {
    const output = redactSecrets(`Error: 401 for ${anthropic} (Bearer ${anthropic})`);
    expect(output).not.toContain(anthropic.slice(10));
  });
});

describe("maskSecret", () => {
  test("keeps only a short prefix and suffix", () => {
    expect(maskSecret(anthropic)).toBe("sk-ant-…6789");
  });

  test("hides short values completely", () => {
    expect(maskSecret("short")).toBe("••••");
  });
});
