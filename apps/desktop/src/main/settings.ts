import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";

const SettingsFile = z.object({
  version: z.literal(1),
  /** MCP server id → on/off, for optional servers. Required servers ignore it. */
  mcpEnabled: z.record(z.string(), z.boolean()).default({}),
  /** Added skills the user switched off; the rest are on. */
  skillsDisabled: z.array(z.string()).default([]),
});
type Settings = z.infer<typeof SettingsFile>;

/** App preferences owned by main, in a small JSON file under userData. */
export class SettingsStore {
  private settings: Settings;

  constructor(private readonly file: string) {
    this.settings = this.load();
  }

  isMcpEnabled(id: string): boolean {
    return this.settings.mcpEnabled[id] ?? false;
  }

  setMcpEnabled(id: string, enabled: boolean): void {
    this.settings = {
      ...this.settings,
      mcpEnabled: { ...this.settings.mcpEnabled, [id]: enabled },
    };
    this.persist();
  }

  isSkillEnabled(id: string): boolean {
    return !this.settings.skillsDisabled.includes(id);
  }

  setSkillEnabled(id: string, enabled: boolean): void {
    const others = this.settings.skillsDisabled.filter((s) => s !== id);
    this.settings = { ...this.settings, skillsDisabled: enabled ? others : [...others, id] };
    this.persist();
  }

  private load(): Settings {
    const empty: Settings = { version: 1, mcpEnabled: {}, skillsDisabled: [] };
    if (!existsSync(this.file)) return empty;
    try {
      return SettingsFile.parse(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      return empty;
    }
  }

  private persist(): void {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.settings, null, 2));
    renameSync(temp, this.file);
  }
}
