use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{oneshot, Mutex};

const BRIDGE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceRequest {
    id: String,
    tool: String,
    arguments: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceResult {
    pub ok: bool,
    #[serde(default)]
    pub value: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
}

struct AgentBridgeInner {
    next_id: AtomicU64,
    pending: Mutex<HashMap<String, oneshot::Sender<WorkspaceResult>>>,
}

#[derive(Clone)]
pub struct AgentBridge {
    inner: Arc<AgentBridgeInner>,
}

impl Default for AgentBridge {
    fn default() -> Self {
        Self {
            inner: Arc::new(AgentBridgeInner {
                next_id: AtomicU64::new(1),
                pending: Mutex::new(HashMap::new()),
            }),
        }
    }
}

impl AgentBridge {
    pub async fn request(
        &self,
        app: &AppHandle,
        tool: &str,
        arguments: Value,
    ) -> std::result::Result<Value, String> {
        let sequence = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let id = format!("workspace-{sequence}");
        let (sender, receiver) = oneshot::channel();
        self.inner.pending.lock().await.insert(id.clone(), sender);

        if let Err(error) = app.emit(
            "agent-workspace-request",
            WorkspaceRequest {
                id: id.clone(),
                tool: tool.to_string(),
                arguments,
            },
        ) {
            self.inner.pending.lock().await.remove(&id);
            return Err(format!("failed to send workspace request: {error}"));
        }

        let response = match tokio::time::timeout(BRIDGE_TIMEOUT, receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => return Err("workspace request was cancelled".into()),
            Err(_) => {
                self.inner.pending.lock().await.remove(&id);
                return Err("workspace request timed out".into());
            }
        };
        if response.ok {
            Ok(response.value.unwrap_or(Value::Null))
        } else {
            Err(response
                .error
                .unwrap_or_else(|| "workspace request failed".into()))
        }
    }
}

#[tauri::command]
pub async fn complete_agent_workspace_request(
    state: State<'_, AgentBridge>,
    id: String,
    result: WorkspaceResult,
) -> std::result::Result<(), String> {
    let Some(sender) = state.inner.pending.lock().await.remove(&id) else {
        return Err(format!("unknown or expired workspace request '{id}'"));
    };
    sender
        .send(result)
        .map_err(|_| format!("workspace request '{id}' is no longer waiting"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unknown_completion_is_rejected() {
        let bridge = AgentBridge::default();
        let result = bridge.inner.pending.lock().await.remove("missing");
        assert!(result.is_none());
    }
}
