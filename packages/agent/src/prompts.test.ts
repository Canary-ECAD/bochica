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

  test("the working folder section appears only with built-in tools", () => {
    expect(systemPrompt("draw")).not.toContain("# Working folder");
    const consult = systemPrompt("consult", [], { folder: "C:/Work" });
    expect(consult).toContain("working folder for this conversation is C:/Work");
    expect(consult).not.toContain("PowerShell");
    expect(systemPrompt("tasks", [], { folder: "C:/Work", terminal: true })).toContain(
      "run PowerShell commands",
    );
  });

  test("added skills are listed by name and description only", () => {
    expect(systemPrompt("tasks")).not.toContain("# Skills");
    const prompt = systemPrompt("draw", [], {
      skills: [{ name: "plc-labels", description: "Name PLC\n  inputs." }],
    });
    expect(prompt).toContain("# Skills");
    expect(prompt).toContain("- plc-labels: Name PLC inputs.");
    expect(prompt).toContain("bochica__use_skill");
  });

  test("every mode shares the base rules", () => {
    for (const mode of ["consult", "tasks", "draw"] as const) {
      expect(systemPrompt(mode)).toContain("Answer in the language the user writes in.");
    }
  });
});
