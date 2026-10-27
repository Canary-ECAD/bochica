import { expect, test } from "bun:test";
import type { TFunction } from "i18next";
import { greeting } from "./greeting";

// A fake t() that shows which key and values were asked for.
const t = ((key: string, values?: Record<string, string>) =>
  values ? `${key}:${Object.values(values).join(",")}` : key) as unknown as TFunction;

test.each([
  // 2026-10-27 is day 300 → 300 % 3 = 0 → time of day.
  [new Date(2026, 9, 27, 9), "greeting.morning"],
  [new Date(2026, 9, 27, 15), "greeting.afternoon"],
  [new Date(2026, 9, 27, 22), "greeting.evening"],
  [new Date(2026, 9, 27, 3), "greeting.evening"],
  // Day 301 → weekday (a Wednesday).
  [new Date(2026, 9, 28, 9), "greeting.weekday:miércoles"],
  // Day 302 → "New task".
  [new Date(2026, 9, 29, 9), "greeting.newTask"],
])("%s → %s", (date, expected) => {
  expect(greeting(t, "es", date)).toBe(expected);
});
