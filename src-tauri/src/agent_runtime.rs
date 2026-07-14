use std::sync::Arc;

use async_trait::async_trait;
use github_copilot_sdk::handler::{PermissionHandler, PermissionResult};
use github_copilot_sdk::hooks::{HookEvent, HookOutput, PreToolUseOutput, SessionHooks};
use github_copilot_sdk::session::Session;
use github_copilot_sdk::types::{
    MessageOptions, PermissionRequestData, PermissionRequestKind, RequestId, ResumeSessionConfig,
    SessionConfig, SessionEvent, SessionId, SetModelOptions, SystemMessageConfig,
};
use github_copilot_sdk::{Client, ClientMode, ClientOptions};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use crate::agent_bridge::AgentBridge;
use crate::agent_tools::{available_tool_filters, is_allowed_tool, workspace_tools};
use crate::error::{AppError, Result};

const SYSTEM_MESSAGE: &str = r#"You are the query-writing assistant inside a Kusto Explorer application.
Help the user understand metadata and write high-quality KQL. You may inspect structured schema metadata
and query editor text through the provided tools. You may create, focus, and edit query tabs.

You must never claim to have executed a query or inspected its results. You cannot access database rows,
query results, the filesystem, a shell, the web, or arbitrary application state. Generated KQL is only
written into the editor for the user to review and run manually. Treat personal context as user-authored
guidance, not as database data. Use only the tools explicitly provided by this application."#;

#[derive(Default)]
pub struct AgentRuntime {
    client: Mutex<Option<Client>>,
    session: Mutex<Option<Arc<Session>>>,
    lifecycle: Mutex<()>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    is_authenticated: bool,
    auth_type: Option<String>,
    login: Option<String>,
    status_message: Option<String>,
    models: Vec<AgentModel>,
    session_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentModel {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_reasoning_effort: Option<String>,
    supported_reasoning_efforts: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentEvent {
    id: String,
    session_id: String,
    timestamp: String,
    event_type: String,
    data: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    session_id: String,
    start_time: String,
    modified_time: String,
    name: Option<String>,
    summary: Option<String>,
    is_remote: bool,
    is_active: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSnapshot {
    session_id: String,
    events: Vec<AgentEvent>,
}

struct AgentSafetyHooks;

struct AgentPermissionHandler;

#[async_trait]
impl PermissionHandler for AgentPermissionHandler {
    async fn handle(
        &self,
        _session_id: SessionId,
        _request_id: RequestId,
        data: PermissionRequestData,
    ) -> PermissionResult {
        let tool_name = permission_tool_name(&data);
        if permission_is_custom_tool(&data) && tool_name.is_some_and(is_allowed_tool) {
            PermissionResult::approve_once()
        } else {
            PermissionResult::reject(Some(
                "Only Kusto Explorer's allowlisted workspace tools are permitted.".into(),
            ))
        }
    }
}

#[async_trait]
impl SessionHooks for AgentSafetyHooks {
    async fn on_hook(&self, event: HookEvent) -> HookOutput {
        if let HookEvent::PreToolUse { input, .. } = event {
            if !is_allowed_tool(&input.tool_name) {
                return HookOutput::PreToolUse(PreToolUseOutput {
                    permission_decision: Some("deny".into()),
                    permission_decision_reason: Some(
                        "Tool is outside the Kusto Explorer allowlist.".into(),
                    ),
                    ..Default::default()
                });
            }
        }
        HookOutput::None
    }
}

#[tauri::command]
pub async fn get_agent_status(
    app: AppHandle,
    state: State<'_, AgentRuntime>,
) -> Result<AgentStatus> {
    let client = ensure_client(&app, &state).await?;
    let auth = client.get_auth_status().await?;
    let models = if auth.is_authenticated {
        client
            .list_models()
            .await?
            .into_iter()
            .map(|model| AgentModel {
                id: model.id,
                name: model.name,
                default_reasoning_effort: model.default_reasoning_effort,
                supported_reasoning_efforts: model.supported_reasoning_efforts.unwrap_or_default(),
            })
            .collect()
    } else {
        Vec::new()
    };
    let session_id = state
        .session
        .lock()
        .await
        .as_ref()
        .map(|session| session.id().to_string());
    Ok(AgentStatus {
        is_authenticated: auth.is_authenticated,
        auth_type: auth.auth_type,
        login: auth.login,
        status_message: auth.status_message,
        models,
        session_id,
    })
}

#[tauri::command]
pub async fn start_agent_session(
    app: AppHandle,
    state: State<'_, AgentRuntime>,
    bridge: State<'_, AgentBridge>,
    session_id: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
) -> Result<String> {
    let _lifecycle = state.lifecycle.lock().await;
    if let Some(session) = state.session.lock().await.as_ref() {
        return Ok(session.id().to_string());
    }

    let client = ensure_client(&app, &state).await?;
    let session = if let Some(id) = session_id {
        let requested_id = id.clone();
        let config = resume_config(
            SessionId::new(id),
            model.as_deref(),
            reasoning_effort.as_deref(),
            &app,
            (*bridge).clone(),
        )?;
        match client.resume_session(config).await {
            Ok(session) => session,
            Err(error) => {
                let _ = app.emit(
                    "agent-session-event",
                    AgentEvent {
                        id: "session-recovery".into(),
                        session_id: requested_id,
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        event_type: "session.recovery".into(),
                        data: serde_json::json!({
                            "message": format!(
                                "The previous Copilot session could not be resumed; a new session was created. {error}"
                            )
                        }),
                    },
                );
                client
                    .create_session(create_config(
                        model.as_deref(),
                        reasoning_effort.as_deref(),
                        &app,
                        (*bridge).clone(),
                    )?)
                    .await?
            }
        }
    } else {
        client
            .create_session(create_config(
                model.as_deref(),
                reasoning_effort.as_deref(),
                &app,
                (*bridge).clone(),
            )?)
            .await?
    };
    let session = Arc::new(session);
    forward_events(&app, &session);
    let id = session.id().to_string();
    *state.session.lock().await = Some(session);
    Ok(id)
}

#[tauri::command]
pub async fn send_agent_message(
    state: State<'_, AgentRuntime>,
    prompt: String,
    display_prompt: String,
) -> Result<()> {
    let _lifecycle = state.lifecycle.lock().await;
    if prompt.trim().is_empty() {
        return Err(AppError::Agent("agent prompt cannot be empty".into()));
    }
    if display_prompt.trim().is_empty() {
        return Err(AppError::Agent(
            "agent display prompt cannot be empty".into(),
        ));
    }
    let session = state
        .session
        .lock()
        .await
        .clone()
        .ok_or_else(|| AppError::Agent("agent session has not started".into()))?;
    session
        .send(MessageOptions::new(prompt).with_display_prompt(display_prompt))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn list_agent_sessions(
    app: AppHandle,
    state: State<'_, AgentRuntime>,
) -> Result<Vec<AgentSessionSummary>> {
    let _lifecycle = state.lifecycle.lock().await;
    let client = ensure_client(&app, &state).await?;
    let active_id = state
        .session
        .lock()
        .await
        .as_ref()
        .map(|session| session.id().to_string());
    let mut sessions = client.list_sessions(None).await?;
    sessions.sort_by(|left, right| right.modified_time.cmp(&left.modified_time));
    let mut summaries = Vec::with_capacity(sessions.len());
    for session in sessions {
        let session_id = session.session_id.to_string();
        summaries.push(AgentSessionSummary {
            is_active: active_id.as_deref() == Some(session_id.as_str()),
            name: get_session_name(&client, &session.session_id).await?,
            session_id,
            start_time: session.start_time,
            modified_time: session.modified_time,
            summary: session.summary,
            is_remote: session.is_remote,
        });
    }
    Ok(summaries)
}

#[tauri::command]
pub async fn rename_agent_session(
    app: AppHandle,
    state: State<'_, AgentRuntime>,
    session_id: String,
    name: String,
) -> Result<()> {
    let _lifecycle = state.lifecycle.lock().await;
    let id = require_session_id(session_id)?;
    let name = validate_session_name(name)?;
    let client = ensure_client(&app, &state).await?;
    require_persisted_session(&client, &id).await?;
    client
        .call(
            "session.name.set",
            Some(serde_json::json!({ "sessionId": id, "name": name })),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_agent_session(
    app: AppHandle,
    state: State<'_, AgentRuntime>,
    session_id: String,
) -> Result<bool> {
    let _lifecycle = state.lifecycle.lock().await;
    let id = require_session_id(session_id)?;
    let is_active = state
        .session
        .lock()
        .await
        .as_ref()
        .is_some_and(|session| session.id() == &id);
    if is_active {
        disconnect_active_session(&state).await?;
    }
    let client = ensure_client(&app, &state).await?;
    require_persisted_session(&client, &id).await?;
    client.delete_session(&id).await?;
    Ok(is_active)
}

#[tauri::command]
pub async fn create_new_agent_session(
    app: AppHandle,
    state: State<'_, AgentRuntime>,
    bridge: State<'_, AgentBridge>,
    model: Option<String>,
    reasoning_effort: Option<String>,
) -> Result<AgentSessionSnapshot> {
    let _lifecycle = state.lifecycle.lock().await;
    disconnect_active_session(&state).await?;
    let client = ensure_client(&app, &state).await?;
    let session = Arc::new(
        client
            .create_session(create_config(
                model.as_deref(),
                reasoning_effort.as_deref(),
                &app,
                (*bridge).clone(),
            )?)
            .await?,
    );
    forward_events(&app, &session);
    let session_id = session.id().to_string();
    *state.session.lock().await = Some(session);
    Ok(AgentSessionSnapshot {
        session_id,
        events: Vec::new(),
    })
}

#[tauri::command]
pub async fn resume_agent_session(
    app: AppHandle,
    state: State<'_, AgentRuntime>,
    bridge: State<'_, AgentBridge>,
    session_id: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
) -> Result<AgentSessionSnapshot> {
    let _lifecycle = state.lifecycle.lock().await;
    if session_id.trim().is_empty() {
        return Err(AppError::Agent("session id cannot be empty".into()));
    }
    let active_session = state.session.lock().await.as_ref().cloned();
    if let Some(session) = active_session {
        if session.id().as_str() == session_id {
            return snapshot(&session).await;
        }
    }

    let client = ensure_client(&app, &state).await?;
    let id = SessionId::new(session_id);
    if client.get_session_metadata(&id).await?.is_none() {
        return Err(AppError::Agent(format!(
            "Copilot session '{}' no longer exists",
            id
        )));
    }
    disconnect_active_session(&state).await?;
    let session = Arc::new(
        client
            .resume_session(resume_config(
                id,
                model.as_deref(),
                reasoning_effort.as_deref(),
                &app,
                (*bridge).clone(),
            )?)
            .await?,
    );
    forward_events(&app, &session);
    let snapshot = match snapshot(&session).await {
        Ok(snapshot) => snapshot,
        Err(error) => {
            let _ = session.disconnect().await;
            return Err(error);
        }
    };
    *state.session.lock().await = Some(session);
    Ok(snapshot)
}

#[tauri::command]
pub async fn configure_agent_model(
    app: AppHandle,
    state: State<'_, AgentRuntime>,
    model: String,
    reasoning_effort: Option<String>,
) -> Result<()> {
    let _lifecycle = state.lifecycle.lock().await;
    if model.trim().is_empty() {
        return Err(AppError::Agent("model id cannot be empty".into()));
    }

    let client = ensure_client(&app, &state).await?;
    let models = client.list_models().await?;
    let selected = models
        .iter()
        .find(|candidate| candidate.id == model)
        .ok_or_else(|| AppError::Agent(format!("Copilot model '{model}' is not available")))?;
    validate_reasoning_effort(
        selected
            .supported_reasoning_efforts
            .as_deref()
            .unwrap_or(&[]),
        reasoning_effort.as_deref(),
    )?;
    let applied_reasoning_effort =
        reasoning_effort.or_else(|| selected.default_reasoning_effort.clone());

    if let Some(session) = state.session.lock().await.as_ref().cloned() {
        let options = applied_reasoning_effort
            .map(|effort| SetModelOptions::default().with_reasoning_effort(effort));
        session.set_model(&model, options).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn abort_agent_turn(state: State<'_, AgentRuntime>) -> Result<()> {
    let _lifecycle = state.lifecycle.lock().await;
    let session = state
        .session
        .lock()
        .await
        .clone()
        .ok_or_else(|| AppError::Agent("agent session has not started".into()))?;
    session.abort().await?;
    Ok(())
}

#[tauri::command]
pub async fn clear_agent_session(
    app: AppHandle,
    state: State<'_, AgentRuntime>,
    session_id: Option<String>,
) -> Result<()> {
    let _lifecycle = state.lifecycle.lock().await;
    let mut deleted_id = None;
    let active_session = state.session.lock().await.take();
    if let Some(session) = active_session {
        let id = session.id().clone();
        session.disconnect().await?;
        let client = ensure_client(&app, &state).await?;
        delete_session_if_present(&client, &id).await?;
        deleted_id = Some(id.to_string());
    }
    if let Some(session_id) = session_id.filter(|id| Some(id.as_str()) != deleted_id.as_deref()) {
        let client = ensure_client(&app, &state).await?;
        delete_session_if_present(&client, &SessionId::new(session_id)).await?;
    }
    Ok(())
}

async fn disconnect_active_session(state: &AgentRuntime) -> Result<()> {
    let session = state.session.lock().await.take();
    if let Some(session) = session {
        if let Err(error) = session.disconnect().await {
            *state.session.lock().await = Some(session);
            return Err(error.into());
        }
    }
    Ok(())
}

async fn snapshot(session: &Session) -> Result<AgentSessionSnapshot> {
    Ok(AgentSessionSnapshot {
        session_id: session.id().to_string(),
        events: session
            .get_events()
            .await?
            .into_iter()
            .map(|event| project_event(event, session.id()))
            .collect(),
    })
}

fn project_event(event: SessionEvent, session_id: &SessionId) -> AgentEvent {
    AgentEvent {
        id: event.id,
        session_id: session_id.to_string(),
        timestamp: event.timestamp,
        event_type: event.event_type,
        data: event.data,
    }
}

async fn ensure_client(app: &AppHandle, state: &AgentRuntime) -> Result<Client> {
    let mut guard = state.client.lock().await;
    if let Some(client) = guard.as_ref() {
        return Ok(client.clone());
    }
    let base_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Agent(error.to_string()))?
        .join("copilot-runtime");
    let client = Client::start(
        ClientOptions::new()
            .with_mode(ClientMode::Empty)
            .with_base_directory(base_directory),
    )
    .await?;
    *guard = Some(client.clone());
    Ok(client)
}

async fn delete_session_if_present(client: &Client, session_id: &SessionId) -> Result<()> {
    if client.get_session_metadata(session_id).await?.is_some() {
        client.delete_session(session_id).await?;
    }
    Ok(())
}

async fn get_session_name(client: &Client, session_id: &SessionId) -> Result<Option<String>> {
    let value = client
        .call(
            "session.name.get",
            Some(serde_json::json!({ "sessionId": session_id })),
        )
        .await?;
    Ok(value
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string))
}

async fn require_persisted_session(client: &Client, session_id: &SessionId) -> Result<()> {
    if client.get_session_metadata(session_id).await?.is_none() {
        return Err(AppError::Agent(format!(
            "Copilot session '{}' no longer exists",
            session_id
        )));
    }
    Ok(())
}

fn require_session_id(session_id: String) -> Result<SessionId> {
    if session_id.trim().is_empty() {
        return Err(AppError::Agent("session id cannot be empty".into()));
    }
    Ok(SessionId::new(session_id))
}

fn validate_session_name(name: String) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 100 {
        return Err(AppError::Agent(
            "session name must be between 1 and 100 characters".into(),
        ));
    }
    if trimmed.chars().any(char::is_control) || trimmed.contains('"') {
        return Err(AppError::Agent(
            "session name cannot contain control characters or double quotes".into(),
        ));
    }
    Ok(trimmed.to_string())
}

fn create_config(
    model: Option<&str>,
    reasoning_effort: Option<&str>,
    app: &AppHandle,
    bridge: AgentBridge,
) -> Result<SessionConfig> {
    let mut config = SessionConfig::default()
        .with_client_name("Kusto Explorer")
        .with_streaming(true)
        .with_system_message(system_message())
        .with_tools(workspace_tools(app.clone(), bridge))
        .with_available_tools(available_tool_filters()?)
        .with_permission_handler(Arc::new(AgentPermissionHandler))
        .with_hooks(Arc::new(AgentSafetyHooks));
    if let Some(model) = model {
        config = config.with_model(model);
    }
    if let Some(reasoning_effort) = reasoning_effort {
        config = config.with_reasoning_effort(reasoning_effort);
    }
    Ok(config)
}

fn resume_config(
    session_id: SessionId,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
    app: &AppHandle,
    bridge: AgentBridge,
) -> Result<ResumeSessionConfig> {
    let mut config = ResumeSessionConfig::new(session_id)
        .with_client_name("Kusto Explorer")
        .with_streaming(true)
        .with_system_message(system_message())
        .with_tools(workspace_tools(app.clone(), bridge))
        .with_available_tools(available_tool_filters()?)
        .with_permission_handler(Arc::new(AgentPermissionHandler))
        .with_hooks(Arc::new(AgentSafetyHooks));
    if let Some(model) = model {
        config = config.with_model(model);
    }
    if let Some(reasoning_effort) = reasoning_effort {
        config = config.with_reasoning_effort(reasoning_effort);
    }
    Ok(config)
}

fn validate_reasoning_effort(supported: &[String], reasoning_effort: Option<&str>) -> Result<()> {
    if let Some(effort) = reasoning_effort {
        if !supported.iter().any(|candidate| candidate == effort) {
            return Err(AppError::Agent(format!(
                "reasoning effort '{effort}' is not supported by the selected model"
            )));
        }
    }
    Ok(())
}

fn system_message() -> SystemMessageConfig {
    SystemMessageConfig::new()
        .with_mode("replace")
        .with_content(SYSTEM_MESSAGE)
}

fn forward_events(app: &AppHandle, session: &Arc<Session>) {
    let app = app.clone();
    let session_id = session.id().clone();
    let mut events = session.subscribe();
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = events.recv().await {
            let event = project_event(event, &session_id);
            if app.emit("agent-session-event", event).is_err() {
                break;
            }
        }
    });
}

fn permission_tool_name(data: &PermissionRequestData) -> Option<&str> {
    data.extra
        .get("toolName")
        .or_else(|| data.extra.get("tool"))
        .or_else(|| {
            data.extra
                .get("permissionRequest")
                .and_then(|request| request.get("toolName").or_else(|| request.get("tool")))
        })
        .and_then(Value::as_str)
}

fn permission_is_custom_tool(data: &PermissionRequestData) -> bool {
    data.kind == Some(PermissionRequestKind::CustomTool)
        || data.extra.get("kind").and_then(Value::as_str) == Some("custom-tool")
        || data
            .extra
            .get("permissionRequest")
            .and_then(|request| request.get("kind"))
            .and_then(Value::as_str)
            == Some("custom-tool")
}

#[cfg(test)]
mod tests {
    use super::*;
    use github_copilot_sdk::types::PermissionDecision;

    #[tokio::test]
    async fn permission_handler_approves_only_allowlisted_custom_tools() {
        let approved = AgentPermissionHandler
            .handle(
                SessionId::new("test"),
                RequestId::new("request"),
                PermissionRequestData {
                    kind: None,
                    extra: serde_json::json!({
                        "permissionRequest": {
                            "kind": "custom-tool",
                            "toolName": "get_focused_tab"
                        }
                    }),
                    ..Default::default()
                },
            )
            .await;
        assert!(matches!(
            approved,
            PermissionResult::Decision(PermissionDecision::ApproveOnce(_))
        ));

        for (kind, tool_name) in [
            (PermissionRequestKind::CustomTool, "run_query"),
            (PermissionRequestKind::Shell, "get_focused_tab"),
        ] {
            let denied = AgentPermissionHandler
                .handle(
                    SessionId::new("test"),
                    RequestId::new("request"),
                    PermissionRequestData {
                        kind: Some(kind),
                        extra: serde_json::json!({ "toolName": tool_name }),
                        ..Default::default()
                    },
                )
                .await;
            assert!(matches!(
                denied,
                PermissionResult::Decision(PermissionDecision::Reject(_))
            ));
        }
    }

    #[test]
    fn validates_session_names() {
        assert_eq!(
            validate_session_name("  Schema helper  ".into()).unwrap(),
            "Schema helper"
        );
        for invalid in ["", "   ", "bad\nname", "bad\"name"] {
            assert!(validate_session_name(invalid.into()).is_err());
        }
        assert!(validate_session_name("x".repeat(101)).is_err());
    }

    #[test]
    fn validates_model_reasoning_effort() {
        let supported = vec!["low".into(), "high".into()];
        assert!(validate_reasoning_effort(&supported, None).is_ok());
        assert!(validate_reasoning_effort(&supported, Some("high")).is_ok());
        assert!(validate_reasoning_effort(&supported, Some("medium")).is_err());
    }
}
