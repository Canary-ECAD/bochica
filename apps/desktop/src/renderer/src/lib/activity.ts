import type { TFunction } from "i18next";

// Plain-language descriptions of tool calls for the activity log and approval cards. Known
// tools get a sentence; anything else falls back to a readable version of its name.

/** i18n key segment per tool source. */
const sources: Record<string, string> = {
  "eplan-docs-2027": "docs2027",
  "eplan-docs-2026": "docs2026",
  "eec-pro-docs": "eecPro",
  eplan: "eplan",
  bochica: "bochica",
};

/** eplan-mcp tools with their own sentence (`activity.eplan.<tool>`). */
const eplanSentences = new Set([
  "eplan_connect",
  "eplan_status",
  "eplan_ping",
  "eplan_get_current_project",
  "eplan_open_project",
  "eplan_close_project",
  "eplan_get_project_property",
  "eplan_get_page_property",
  "eplan_get_property",
  "eplan_set_project_property",
  "eplan_set_page_property",
  "eplan_set_property",
  "eplan_export_pdf_project",
  "eplan_export_pdf_pages",
  "eplan_check_project",
  "eplan_update_reports",
  "eplan_backup_project",
  "eplan_app_shutdown",
  "eplan_app_restart",
]);

function field(input: unknown, name: string): string {
  if (typeof input !== "object" || input === null) return "";
  const value = (input as Record<string, unknown>)[name];
  return typeof value === "string" ? value : "";
}

/** "C:\Projects\Demo.elk" → "Demo"; the folder is in the details, the sentence stays short. */
function projectName(input: unknown): string {
  const path =
    field(input, "project_name") || field(input, "project_path") || field(input, "project");
  return (
    path
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.el[a-z]$/i, "") ?? ""
  );
}

/**
 * One line for one call. "done" is for the activity log ("Exported the project to PDF");
 * "request" is for approval cards, before anything happened ("Export the project to PDF").
 */
export function describeCall(
  t: TFunction,
  server: string,
  tool: string,
  input: unknown,
  mode: "done" | "request" = "done",
): string {
  const source = sources[server];
  if (server === "eplan") {
    if (eplanSentences.has(tool)) {
      const group = mode === "request" ? "eplanRequest" : "eplan";
      return t(`activity.${group}.${tool}`, {
        project: projectName(input),
        property: field(input, "property_name") || field(input, "property_id"),
      });
    }
    if (tool.startsWith("eplan_search_")) return t("activity.eplan.search");
    return t("activity.eplan.other", {
      action: tool.replace(/^(eplan|aas)_/, "").replaceAll("_", " "),
    });
  }
  if (server === "bochica" && tool === "backup_project") {
    return t("activity.backup", { project: field(input, "project") });
  }
  if (server === "bochica" && tool === "dev_echo") {
    return t("activity.devEcho", { text: field(input, "text") });
  }
  if (source && tool.endsWith("_search")) {
    return t(`activity.search.${source}`, { query: field(input, "query") });
  }
  if (source && tool.endsWith("_get")) {
    return t(`activity.read.${source}`, { path: field(input, "path") });
  }
  if (source && tool.endsWith("_stats")) return t(`activity.stats.${source}`);
  return t("activity.used", { tool });
}

/** The collapsed line for a run of calls, e.g. "Consulted the EPLAN 2027 docs 3 times". */
export function describeGroup(t: TFunction, servers: string[]): string {
  const [first] = servers;
  const source = first ? sources[first] : undefined;
  if (source && servers.every((s) => s === first)) {
    return t(`activity.group.${source}`, { count: servers.length });
  }
  // A backup followed by the EPLAN change it protects reads as EPLAN work.
  if (servers.includes("eplan") && servers.every((s) => s === "eplan" || s === "bochica")) {
    return t("activity.group.eplan", { count: servers.length });
  }
  return t("activity.group.mixed", { count: servers.length });
}
