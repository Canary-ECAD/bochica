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
  // eplan-mcp v1.3.0's live object model (eplan-mcp#82).
  "eplan_live_place_device",
  "eplan_live_place_terminal",
  "eplan_live_insert_macro",
  "eplan_live_place_panel_item",
  "eplan_live_place_plc_point",
  "eplan_live_place_cable_definition",
  "eplan_live_update_placement",
  "eplan_live_batch",
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
  "eplan_live_find_placements",
  "eplan_live_render_page",
  "eplan_live_check_page",
  // Pins the project the drawing goes to, so the user can keep working in EPLAN meanwhile.
  "eplan_live_set_target_project",
  // A call blocked by an EPLAN dialog names it; reading it lets the agent show the user.
  "eplan_list_dialogs",
]);

/**
 * Tools no mode gets, each group with its reason. They are listed by the pinned server but don't
 * fit how Bochica ships and guards EPLAN.
 */
const notOffered = new Set([
  // The C# script host (eplan-mcp#83). On first use it downloads its host from a GitHub release
  // into the user's profile, outside the pinned runtime an update replaces; that release isn't
  // published yet; it needs EPLAN 2027 and the EPLAN API developer license; and its ad-hoc C#
  // would bypass the parts guard, which reads only eplan_execute_*_script. It comes back once the
  // host ships inside the runtime and the guard reads its scripts.
  "eplan_script_hello",
  "eplan_script_run",
  "eplan_script_status",
  "eplan_script_cancel",
  "eplan_script_list",
  "eplan_script_offline_stop",
  "eplan_script_host_install",
  // Clean-up halves of tools eplan-mcp keeps off unless EPLAN_MCP_ENABLE_TOOLS lists them
  // (scratch symbol libraries, the UI dismiss watch). Bochica never enables them, so there is
  // nothing to restore, purge or stop.
  "eplan_scratch_symbols_restore",
  "eplan_scratch_symbols_purge",
  "eplan_scratch_symbols_status",
  "eplan_assert_isolation",
  "eplan_ui_dismiss_watch_stop",
]);

export function eplanToolInMode(tool: string, mode: ChatMode): boolean {
  if (notOffered.has(tool)) return false;
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
  ...notOffered,
]);
