import { expect, test } from "bun:test";
import en from "./en.json";
import es from "./es.json";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "object" && child !== null
      ? keys(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

test("every translation has exactly the keys of en.json", () => {
  expect(keys(es).toSorted()).toEqual(keys(en).toSorted());
});
