import { describe, expect, test } from "bun:test";
import { systemPrompt } from "./prompts";

const skill = {
  name: "eplan-scripting",
  description: "Write EPLAN scripts",
  body: "Always dispose the Progress object.",
  references: ["eplan-p8/eplan-scripting/references/pitfalls.md"],
};

describe("systemPrompt", () => {
  test("Consult includes the scripting guide and says it can't act", () => {
    const prompt = systemPrompt("consult", [skill]);
    expect(prompt).toContain("# Mode: Consult");
    expect(prompt).toContain("Always dispose the Progress object.");
    expect(prompt).toContain("- eplan-p8/eplan-scripting/references/pitfalls.md");
    expect(prompt).toContain("You cannot act on EPLAN");
  });

  test("Tasks has the acting rules and no scripting guide", () => {
    const prompt = systemPrompt("tasks", [skill]);
    expect(prompt).toContain("# Mode: Tasks");
    expect(prompt).toContain("approval card");
    expect(prompt).not.toContain("Always dispose");
  });

  test("Draw says it is experimental and keeps the acting rules", () => {
    const prompt = systemPrompt("draw");
    expect(prompt).toContain("experimental");
    expect(prompt).toContain("approval card");
  });

  test("every mode shares the base rules", () => {
    for (const mode of ["consult", "tasks", "draw"] as const) {
      expect(systemPrompt(mode)).toContain("Answer in the language the user writes in.");
    }
  });
});
