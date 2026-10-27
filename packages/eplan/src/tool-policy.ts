// How Bochica guards each eplan-mcp tool (guardrails layers 5 and 6). eplan-mcp publishes no
// safety annotations, so the classification lives here. Anything not listed is treated as a
// project change that asks first: a new upstream tool is safe by default, never silently
// read-only. Keep the lists in sync with fixtures/eplan-mcp-tools.txt when bumping eplan-mcp.

export interface EplanToolPolicy {
  approval: "never" | "ask" | "always";
  /** Changes a project, so Bochica backs it up before the first such call in a session. */
  changesProject: boolean;
}

/** Only read EPLAN, the parts database or the docs, or move the GUI around. Never ask. */
const readTools = new Set([
  "eplan_status",
  "eplan_versions",
  "eplan_servers",
  "eplan_connect",
  "eplan_disconnect",
  "eplan_ping",
  "eplan_test",
  "eplan_list_extensions",
  "eplan_get_current_project",
  "eplan_get_selected_pages",
  "eplan_get_project_property",
  "eplan_get_page_property",
  "eplan_get_property",
  "eplan_search_devices",
  "eplan_search_text",
  "eplan_search_all_properties",
  "eplan_search_page_data",
  "eplan_search_project_data",
  "eplan_edit_open_page",
  "eplan_edit_goto_device",
  "eplan_edit_open_layout_space",
  "eplan_close_pages",
  "eplan_redraw_ged",
  "eplan_preview_page",
  "eplan_select_device",
  "eplan_navigate_to_eec",
  "eplan_parts_db_query",
  "eplan_parts_db_count",
  "eplan_parts_db_get_part",
  "eplan_parts_db_list_product_groups",
  "eplan_settings_get_string",
  "eplan_settings_get_bool",
  "eplan_settings_get_int",
  "eplan_settings_get_double",
  "eplan_settings_list_children",
  "eplan_pathmap_substitute",
  "eplan_pathmap_get_common_paths",
  "eplan_get_system_messages",
  "eplan_scratch_project_list",
  "eplan_list_schemes",
  "eplan_list_report_templates",
  "eplan_list_layers",
  "eplan_list_enums",
  "eplan_api_types",
  "eplan_api_describe",
  "eplan_action_catalog",
  "eplan_action_describe",
  "eplan_ribbon_catalog",
  "eplan_live_query_functions",
  "eplan_live_query_pages",
  "eplan_live_read_check_messages",
  "eplan_live_symbol_catalog",
  "eplan_live_read_page",
  "eplan_live_verify_page",
  "eplan_live_read_connections",
  "eplan_live_routing_catalog",
  "aas_inspect_package",
]);

/**
 * Ask every time, even after "Allow for this session": they can lose work, touch more than one
 * project, run arbitrary code, or change EPLAN itself (settings, add-ins, parts database).
 */
const alwaysTools = new Set([
  "eplan_app_shutdown",
  "eplan_app_restart",
  "eplan_restore_project",
  "eplan_restore_masterdata",
  "eplan_project_management",
  "eplan_execute_raw_action",
  "eplan_action_run",
  "eplan_execute_script",
  "eplan_execute_custom_script",
  "eplan_register_script",
  "eplan_unregister_script",
  "eplan_load_api_module",
  "eplan_load_api_module_net",
  "eplan_register_addon",
  "eplan_unregister_addon",
  "eplan_register_custom_property_editor",
  "eplan_delete_device_list",
  "eplan_delete_representation_type",
  "eplan_remove_language",
  "eplan_live_remove_placement",
  "eplan_masterdata_operation",
  "eplan_scratch_project_discard",
  "eplan_lock_unlock_all_objects",
  "eplan_switch_project_type",
  "eplan_compress_project",
  "eplan_upgrade_projects",
  "eplan_convert_base_projects",
  "eplan_set_setting",
  "eplan_import_settings",
  "eplan_settings_set_string",
  "eplan_settings_set_bool",
  "eplan_settings_set_int",
  "eplan_settings_set_double",
  "eplan_parts_db_create",
  "eplan_parts_db_update",
  "eplan_partsmanagement_import",
  "eplan_set_parts_data_source",
  "eplan_import_ribbon_bar",
  "eplan_clean_workspace",
  "aas_import_parts",
]);

/** `always` tools that don't change the open project, so no backup is made for them. */
const alwaysWithoutProjectChange = new Set([
  "eplan_app_shutdown",
  "eplan_app_restart",
  "eplan_restore_project",
  "eplan_restore_masterdata",
  "eplan_register_script",
  "eplan_unregister_script",
  "eplan_load_api_module",
  "eplan_load_api_module_net",
  "eplan_register_addon",
  "eplan_unregister_addon",
  "eplan_register_custom_property_editor",
  "eplan_masterdata_operation",
  "eplan_scratch_project_discard",
  "eplan_set_setting",
  "eplan_import_settings",
  "eplan_settings_set_string",
  "eplan_settings_set_bool",
  "eplan_settings_set_int",
  "eplan_settings_set_double",
  "eplan_parts_db_create",
  "eplan_parts_db_update",
  "eplan_partsmanagement_import",
  "eplan_set_parts_data_source",
  "eplan_import_ribbon_bar",
  "eplan_clean_workspace",
  "aas_import_parts",
]);

/**
 * Ask, but need no backup: they write files outside the project (exports, prints, backups) or
 * only open, close, check or arrange things.
 */
const askWithoutProjectChange = new Set([
  "eplan_backup_project",
  "eplan_backup_masterdata",
  "eplan_open_project",
  "eplan_close_project",
  "eplan_check_project",
  "eplan_check_pages",
  "eplan_check_parts",
  "eplan_open_workspace",
  "eplan_save_workspace",
  "eplan_app_launch",
  "eplan_scratch_project_create",
  "eplan_select_part",
  "eplan_start_ged_interaction",
  "eplan_dc_export",
  "eplan_plc_export",
]);

const exportPrefixes = [
  "eplan_export_",
  "eplan_print_",
  "eplan_partsmanagement_export",
  "aas_export_",
];

export function eplanToolPolicy(tool: string): EplanToolPolicy {
  if (readTools.has(tool)) return { approval: "never", changesProject: false };
  if (alwaysTools.has(tool)) {
    return { approval: "always", changesProject: !alwaysWithoutProjectChange.has(tool) };
  }
  if (askWithoutProjectChange.has(tool) || exportPrefixes.some((p) => tool.startsWith(p))) {
    return { approval: "ask", changesProject: false };
  }
  return { approval: "ask", changesProject: true };
}

/** Every name listed above, for the test that keeps the lists in sync with eplan-mcp. */
export const classifiedEplanTools: ReadonlySet<string> = new Set([
  ...readTools,
  ...alwaysTools,
  ...askWithoutProjectChange,
]);
