use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, Result};

const DATA_VERSION: u32 = 1;
const MAX_CONTEXT_ENTRY_BYTES: usize = 64 * 1024;
const MAX_MESSAGE_BYTES: usize = 128 * 1024;
const MAX_TRANSCRIPT_BYTES: usize = 2 * 1024 * 1024;
const MAX_MESSAGES: usize = 1_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextEntry {
    pub key: String,
    pub scope: String,
    pub cluster_id: String,
    pub cluster_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_name: Option<String>,
    pub content: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextData {
    pub version: u32,
    pub entries: Vec<AgentContextEntry>,
}

impl Default for AgentContextData {
    fn default() -> Self {
        Self {
            version: DATA_VERSION,
            entries: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub kind: String,
    pub content: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_arguments: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversationData {
    pub version: u32,
    pub session_id: Option<String>,
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    pub messages: Vec<AgentMessage>,
}

impl Default for AgentConversationData {
    fn default() -> Self {
        Self {
            version: DATA_VERSION,
            session_id: None,
            model: None,
            reasoning_effort: None,
            messages: Vec::new(),
        }
    }
}

#[tauri::command]
pub fn load_agent_context(app: AppHandle) -> Result<AgentContextData> {
    let data = load_json(&data_path(&app, "agent-context.json")?)?;
    validate_context(&data)?;
    Ok(data)
}

#[tauri::command]
pub fn save_agent_context(app: AppHandle, data: AgentContextData) -> Result<()> {
    validate_context(&data)?;
    save_json(&data_path(&app, "agent-context.json")?, &data)
}

#[tauri::command]
pub fn load_agent_conversation(app: AppHandle) -> Result<AgentConversationData> {
    let data = load_json(&data_path(&app, "agent-conversation.json")?)?;
    validate_conversation(&data)?;
    Ok(data)
}

#[tauri::command]
pub fn save_agent_conversation(app: AppHandle, data: AgentConversationData) -> Result<()> {
    validate_conversation(&data)?;
    save_json(&data_path(&app, "agent-conversation.json")?, &data)
}

#[tauri::command]
pub fn clear_agent_conversation(app: AppHandle) -> Result<()> {
    let path = data_path(&app, "agent-conversation.json")?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn data_path(app: &AppHandle, file_name: &str) -> Result<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Io(error.to_string()))?
        .join("agent");
    Ok(directory.join(file_name))
}

fn validate_version(version: u32) -> Result<()> {
    if version != DATA_VERSION {
        return Err(AppError::Parse(format!(
            "unsupported agent data version {version}"
        )));
    }
    Ok(())
}

fn validate_context(data: &AgentContextData) -> Result<()> {
    validate_version(data.version)?;
    for entry in &data.entries {
        if entry.key.trim().is_empty() || entry.cluster_id.trim().is_empty() {
            return Err(AppError::Parse(
                "agent context entry is missing its identity".into(),
            ));
        }
        if entry.content.len() > MAX_CONTEXT_ENTRY_BYTES {
            return Err(AppError::Parse(format!(
                "agent context entry '{}' exceeds {} bytes",
                entry.key, MAX_CONTEXT_ENTRY_BYTES
            )));
        }
    }
    Ok(())
}

fn validate_conversation(data: &AgentConversationData) -> Result<()> {
    validate_version(data.version)?;
    if data.messages.len() > MAX_MESSAGES {
        return Err(AppError::Parse(format!(
            "agent conversation exceeds {MAX_MESSAGES} messages"
        )));
    }
    let mut total = 0usize;
    for message in &data.messages {
        if message.id.trim().is_empty() {
            return Err(AppError::Parse(
                "agent conversation contains a message without an id".into(),
            ));
        }
        let structured_len = message
            .tool_arguments
            .as_ref()
            .map_or(0, |value| value.to_string().len())
            .saturating_add(
                message
                    .tool_result
                    .as_ref()
                    .map_or(0, |value| value.to_string().len()),
            )
            .saturating_add(message.tool_error.as_ref().map_or(0, String::len));
        let message_len = message.content.len().saturating_add(structured_len);
        if message_len > MAX_MESSAGE_BYTES {
            return Err(AppError::Parse(format!(
                "agent message '{}' exceeds {} bytes",
                message.id, MAX_MESSAGE_BYTES
            )));
        }
        total = total.saturating_add(message_len);
    }
    if total > MAX_TRANSCRIPT_BYTES {
        return Err(AppError::Parse(format!(
            "agent conversation exceeds {MAX_TRANSCRIPT_BYTES} bytes"
        )));
    }
    Ok(())
}

fn load_json<T>(path: &Path) -> Result<T>
where
    T: DeserializeOwned + Default,
{
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(T::default()),
        Err(error) => return Err(error.into()),
    };
    serde_json::from_slice(&raw).map_err(Into::into)
}

fn save_json<T: Serialize>(path: &Path, data: &T) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Io("agent data path has no parent".into()))?;
    fs::create_dir_all(parent)?;
    let bytes = serde_json::to_vec_pretty(data)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(&bytes)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("context.json");
        let data = AgentContextData {
            version: DATA_VERSION,
            entries: vec![AgentContextEntry {
                key: "cluster:test".into(),
                scope: "cluster".into(),
                cluster_id: "test".into(),
                cluster_name: "Test".into(),
                database: None,
                entity_kind: None,
                entity_name: None,
                content: "Use UTC.".into(),
                updated_at: "2026-01-01T00:00:00Z".into(),
            }],
        };
        validate_context(&data).unwrap();
        save_json(&path, &data).unwrap();
        assert_eq!(load_json::<AgentContextData>(&path).unwrap(), data);
    }

    #[test]
    fn rejects_oversized_context() {
        let data = AgentContextData {
            version: DATA_VERSION,
            entries: vec![AgentContextEntry {
                key: "cluster:test".into(),
                scope: "cluster".into(),
                cluster_id: "test".into(),
                cluster_name: "Test".into(),
                database: None,
                entity_kind: None,
                entity_name: None,
                content: "x".repeat(MAX_CONTEXT_ENTRY_BYTES + 1),
                updated_at: "now".into(),
            }],
        };
        assert!(validate_context(&data).is_err());
    }

    #[test]
    fn rejects_unsupported_versions() {
        let data = AgentConversationData {
            version: DATA_VERSION + 1,
            ..AgentConversationData::default()
        };
        assert!(validate_conversation(&data).is_err());
    }

    #[test]
    fn conversation_round_trips_structured_tool_activity() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("conversation.json");
        let data = AgentConversationData {
            version: DATA_VERSION,
            session_id: Some("session-1".into()),
            model: None,
            reasoning_effort: Some("high".into()),
            messages: vec![AgentMessage {
                id: "tool-call-1".into(),
                kind: "tool".into(),
                content: "Read table schema".into(),
                created_at: "2026-01-01T00:00:00Z".into(),
                event_type: Some("tool.execution_complete".into()),
                tool_name: Some("get_table_schema".into()),
                tool_call_id: Some("call-1".into()),
                tool_arguments: Some(serde_json::json!({ "table": "StormEvents" })),
                tool_result: Some(serde_json::json!({ "content": "27 columns" })),
                tool_error: None,
                duration_ms: Some(1250),
                status: Some("complete".into()),
            }],
        };

        validate_conversation(&data).unwrap();
        save_json(&path, &data).unwrap();
        assert_eq!(load_json::<AgentConversationData>(&path).unwrap(), data);
    }

    #[test]
    fn conversation_without_reasoning_effort_remains_compatible() {
        let data: AgentConversationData = serde_json::from_value(serde_json::json!({
            "version": DATA_VERSION,
            "sessionId": null,
            "model": null,
            "messages": []
        }))
        .unwrap();

        assert_eq!(data.reasoning_effort, None);
    }
}
