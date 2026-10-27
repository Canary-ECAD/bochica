import type { ChatMode } from "@bochica/shared";

// Which eplan-mcp tools the agent gets in each mode. Consult: none (docs and scripting help
// only). Tasks: everything except the experimental placement tools. Draw: the placement tools,
// the data edits that go with them, and what they need to read pages and catalogs.

/** Experimental drawing: placing and wiring things on pages. Draw mode only. */
const placementTools = new Set([
  "eplan_live_create_page",
  "eplan_live_place_symbol",
  "eplan_live_place_connected",
  "eplan_live_place_connection_symbol",
  "eplan_live_place_corner",
  "eplan_live_place_tnode",
  "eplan_live_connect_pins",
  "eplan_live_connect_pins_routed",
  "eplan_live_remove_placement",
  "eplan_insert_device",
  "eplan_insert_symbol_reference",
  "eplan_start_ged_interaction",
]);

/** Edits that drawing needs; Tasks keeps them too. */
const drawingEdits = new Set([
  "eplan_live_set_device_tag",
  "eplan_live_set_function_text",
  "eplan_live_set_connection_designations",
]);

/** What drawing needs to see: connection, pages, catalogs, checks. */
const drawingReads = new Set([
  "eplan_status",
  "eplan_connect",
  "eplan_ping",
  "eplan_get_current_project",
  "eplan_get_selected_pages",
  "eplan_get_system_messages",
  "eplan_edit_open_page",
  "eplan_redraw_ged",
  "eplan_preview_page",
  "eplan_list_layers",
  "eplan_live_symbol_catalog",
  "eplan_live_routing_catalog",
  "eplan_live_read_page",
  "eplan_live_verify_page",
  "eplan_live_read_connections",
  "eplan_live_query_pages",
  "eplan_live_query_functions",
  "eplan_live_read_check_messages",
]);

export function eplanToolInMode(tool: string, mode: ChatMode): boolean {
  switch (mode) {
    case "consult":
      return false;
    case "tasks":
      return !placementTools.has(tool);
    case "draw":
      return placementTools.has(tool) || drawingEdits.has(tool) || drawingReads.has(tool);
  }
}

/** For the test that keeps these lists in sync with eplan-mcp. */
export const modeListedTools: ReadonlySet<string> = new Set([
  ...placementTools,
  ...drawingEdits,
  ...drawingReads,
]);
