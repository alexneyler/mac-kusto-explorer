pub mod agent_bridge;
pub mod agent_data;
pub mod agent_runtime;
pub mod agent_tools;
pub mod auth;
pub mod commands;
pub mod error;
pub mod kusto;
pub mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::new())
        .manage(agent_bridge::AgentBridge::default())
        .manage(agent_runtime::AgentRuntime::default())
        .invoke_handler(tauri::generate_handler![
            commands::run_query,
            commands::list_databases,
            commands::get_schema,
            commands::format_share,
            commands::export_csv,
            commands::export_result,
            agent_data::load_agent_context,
            agent_data::save_agent_context,
            agent_data::load_agent_conversation,
            agent_data::save_agent_conversation,
            agent_data::clear_agent_conversation,
            agent_bridge::complete_agent_workspace_request,
            agent_runtime::get_agent_status,
            agent_runtime::start_agent_session,
            agent_runtime::send_agent_message,
            agent_runtime::list_agent_sessions,
            agent_runtime::rename_agent_session,
            agent_runtime::delete_agent_session,
            agent_runtime::create_new_agent_session,
            agent_runtime::resume_agent_session,
            agent_runtime::configure_agent_model,
            agent_runtime::abort_agent_turn,
            agent_runtime::clear_agent_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
