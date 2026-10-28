import { describe, expect, test } from "bun:test";
import { deniedBy } from "./deny-rules";

describe("deny rules", () => {
  const rules = ["Remove-Item*", "git push*", "*\\secret\\*"];

  test.each([
    ["Remove-Item .\\build -Recurse", "Remove-Item*"],
    ["remove-item x.txt", "Remove-Item*"],
    ["rm x.txt", "Remove-Item*"],
    ["del /q x.txt", "Remove-Item*"],
    ["cd out; rm x.txt", "Remove-Item*"],
    ["Get-ChildItem *.tmp | ri", "Remove-Item*"],
    ["Write-Output $(Remove-Item y)", "Remove-Item*"],
    ["git   push origin main", "git push*"],
    ["Get-Content C:\\data\\secret\\a.txt", "*\\secret\\*"],
  ])("%s is denied by %s", (command, rule) => {
    expect(deniedBy(command, rules)).toBe(rule);
  });

  test.each([
    "Get-ChildItem -Recurse",
    "Write-Output 'Remove-Item is a cmdlet'",
    "git status",
    "git pull",
    "Get-Content .\\notes\\secrets.txt",
  ])("%s passes", (command) => {
    expect(deniedBy(command, rules)).toBeNull();
  });

  test("no rules, nothing denied", () => {
    expect(deniedBy("Remove-Item x", [])).toBeNull();
  });

  test("regex characters in a rule are literal", () => {
    expect(deniedBy("Stop-Process (1+1)", ["Stop-Process (1+1)"])).toBe("Stop-Process (1+1)");
    expect(deniedBy("Stop-Process 11", ["Stop-Process (1+1)"])).toBeNull();
    expect(deniedBy("shutdown /r", ["shutdown ?r"])).toBe("shutdown ?r");
  });
});
