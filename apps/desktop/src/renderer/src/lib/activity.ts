import type { TFunction } from "i18next";

// Plain-language descriptions of tool calls for the activity log and approval cards. Known
// tools get a sentence; anything else falls back to "Used <tool>".

/** i18n key segment per tool source. */
const sources: Record<string, string> = {
  "eplan-docs-2027": "docs2027",
  "eplan-docs-2026": "docs2026",
  "eec-pro-docs": "eecPro",
  bochica: "bochica",
};

function field(input: unknown, name: string): string {
  if (typeof input !== "object" || input === null) return "";
  const value = (input as Record<string, unknown>)[name];
  return typeof value === "string" ? value : "";
}

/** One line for one call, e.g. "Searched the EPLAN 2027 docs for “Macro”". */
export function describeCall(t: TFunction, server: string, tool: string, input: unknown): string {
  const source = sources[server];
  if (source && tool.endsWith("_search")) {
    return t(`activity.search.${source}`, { query: field(input, "query") });
  }
  if (source && tool.endsWith("_get"))
    return t(`activity.read.${source}`, { path: field(input, "path") });
  if (source && tool.endsWith("_stats")) return t(`activity.stats.${source}`);
  if (server === "bochica" && tool === "dev_echo")
    return t("activity.devEcho", { text: field(input, "text") });
  return t("activity.used", { tool });
}

/** The collapsed line for a run of calls, e.g. "Consulted the EPLAN 2027 docs 3 times". */
export function describeGroup(t: TFunction, servers: string[]): string {
  const [first] = servers;
  const source = first ? sources[first] : undefined;
  if (source && servers.every((s) => s === first)) {
    return t(`activity.group.${source}`, { count: servers.length });
  }
  return t("activity.group.mixed", { count: servers.length });
}
